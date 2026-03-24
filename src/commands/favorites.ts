import { SlashCommandBuilder } from "@discordjs/builders";
import { APIEmbedField, AutocompleteInteraction, ChatInputCommandInteraction } from "discord.js";
import { inject, injectable } from "inversify";
import Command from "./index.js";
import AddQueryToQueue from "../services/add-query-to-queue.js";
import { TYPES } from "../types.js";
import { prisma } from "../utils/db.js";
import { Pagination } from "pagination.djs";

@injectable()
export default class implements Command {
    public readonly slashCommand = new SlashCommandBuilder()
        .setName("favorites")
        .setDescription("Add a song to your favourites")
        .addSubcommand((subcommand) =>
            subcommand
                .setName("use")
                .setDescription("Use a favourite")
                .addStringOption((option) =>
                    option.setName("name").setDescription("Name of favourite").setRequired(true).setAutocomplete(true)
                )
                .addBooleanOption((option) =>
                    option.setName("immediate").setDescription("Add track to the front of the queue")
                )
                .addBooleanOption((option) =>
                    option.setName("shuffle").setDescription("Shuffle the input if you're adding multiple tracks")
                )
                .addBooleanOption((option) =>
                    option.setName("split").setDescription("If a track has chapters, split it")
                )
                .addBooleanOption((option) => option.setName("skip").setDescription("Skip the currently playing track"))
        )
        .addSubcommand((subcommand) => subcommand.setName("list").setDescription("List all favourites"))
        .addSubcommand((subcommand) =>
            subcommand
                .setName("create")
                .setDescription("Create a new favourite")
                .addStringOption((option) =>
                    option
                        .setName("name")
                        .setDescription("You'll type this when using this favourite")
                        .setRequired(true)
                )
                .addStringOption((option) =>
                    option
                        .setName("query")
                        .setDescription("Any input you'd normally give to the play command")
                        .setRequired(true)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("remove")
                .setDescription("Remove a favourite")
                .addStringOption((option) =>
                    option.setName("name").setDescription("Name of favourite").setAutocomplete(true).setRequired(true)
                )
        );

    constructor(@inject(TYPES.Services.AddQueryToQueue) private readonly addQueryToQueue: AddQueryToQueue) {}

    requiresVC = (interaction: ChatInputCommandInteraction) => interaction.options.getSubcommand() === "use";

    async execute(interaction: ChatInputCommandInteraction) {
        switch (interaction.options.getSubcommand()) {
            case "use":
                await this.use(interaction);
                break;
            case "list":
                await this.list(interaction);
                break;
            case "create":
                await this.create(interaction);
                break;
            case "remove":
                await this.remove(interaction);
                break;
            default:
                throw new Error("unknown subcommand");
        }
    }

    async handleAutocompleteInteraction(interaction: AutocompleteInteraction) {
        const subcommand = interaction.options.getSubcommand();
        const query = interaction.options.getString("name")!.trim();

        const favorites = await prisma.favoriteQuery.findMany({
            where: {
                guildId: interaction.guild!.id,
            },
        });

        let results =
            query === "" ? favorites : favorites.filter((f) => f.name.toLowerCase().startsWith(query.toLowerCase()));

        if (subcommand === "remove") {
            // Only show favorites that user is allowed to remove
            results =
                interaction.member?.user.id === interaction.guild?.ownerId
                    ? results
                    : results.filter((r) => r.authorId === interaction.member!.user.id);
        }

        // Limit results to 25 maximum per Discord limits
        const trimmed = results.length > 25 ? results.slice(0, 25) : results;
        await interaction.respond(
            trimmed.map((r) => ({
                name: r.name,
                value: r.name,
            }))
        );
    }

    private async use(interaction: ChatInputCommandInteraction) {
        const name = interaction.options.getString("name")!.trim();

        const favorite = await prisma.favoriteQuery.findFirst({
            where: {
                name,
                guildId: interaction.guild!.id,
            },
        });

        if (!favorite) {
            throw new Error("no favourite with that name exists");
        }

        await this.addQueryToQueue.addToQueue({
            interaction,
            query: favorite.query,
            shuffleAdditions: interaction.options.getBoolean("shuffle") ?? false,
            addToFrontOfQueue: interaction.options.getBoolean("immediate") ?? false,
            shouldSplitChapters: interaction.options.getBoolean("split") ?? false,
            skipCurrentTrack: interaction.options.getBoolean("skip") ?? false,
        });
    }

    private async list(interaction: ChatInputCommandInteraction) {
        const favorites = await prisma.favoriteQuery.findMany({
            where: {
                guildId: interaction.guild!.id,
            },
        });

        if (favorites.length === 0) {
            await interaction.reply("There aren't any favourites yet");
            return;
        }

        const fields = new Array<APIEmbedField>(favorites.length);
        for (let index = 0; index < favorites.length; index++) {
            const favorite = favorites[index];
            fields[index] = {
                inline: false,
                name: favorite.name,
                value: `${favorite.query} (<@${favorite.authorId}>)`,
            };
        }

        await new Pagination(interaction as ChatInputCommandInteraction<"cached">, { ephemeral: true, limit: 25 })
            .setFields(fields)
            .paginateFields(true)
            .render();
    }

    private async create(interaction: ChatInputCommandInteraction) {
        const name = interaction.options.getString("name")!.trim();
        const query = interaction.options.getString("query")!.trim();

        const existingFavorite = await prisma.favoriteQuery.findFirst({
            where: {
                guildId: interaction.guild!.id,
                name,
            },
        });

        if (existingFavorite) {
            throw new Error("a favourite with that name already exists");
        }

        await prisma.favoriteQuery.create({
            data: {
                authorId: interaction.member!.user.id,
                guildId: interaction.guild!.id,
                name,
                query,
            },
        });

        await interaction.reply("Favourite created");
    }

    private async remove(interaction: ChatInputCommandInteraction) {
        const name = interaction.options.getString("name")!.trim();

        const favorite = await prisma.favoriteQuery.findFirst({
            where: {
                name,
                guildId: interaction.guild!.id,
            },
        });

        if (!favorite) {
            throw new Error("no favourite with that name exists");
        }

        const isUserGuildOwner = interaction.member!.user.id === interaction.guild!.ownerId;

        if (favorite.authorId !== interaction.member!.user.id && !isUserGuildOwner) {
            throw new Error("you can only remove your own favorites");
        }

        await prisma.favoriteQuery.delete({ where: { id: favorite.id } });

        await interaction.reply("Favourite removed");
    }
}
