import { ChatInputCommandInteraction } from "discord.js";
import { TYPES } from "../types.js";
import { inject, injectable } from "inversify";
import PlayerManager from "../managers/player.js";
import Command from "./index.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { buildPlayingMessageEmbed } from "../utils/build-embed.js";

@injectable()
export default class implements Command {
    public readonly slashCommand = new SlashCommandBuilder()
        .setName("skip")
        .setDescription("Skip the next songs")
        .addIntegerOption((option) =>
            option.setName("number").setDescription("Number of songs to skip [default: 1]").setRequired(false)
        );

    public requiresVC = true;

    private readonly playerManager: PlayerManager;

    constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
        this.playerManager = playerManager;
    }

    public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const numToSkip = interaction.options.getInteger("number") ?? 1;
        let skipMessage;

        if (numToSkip < 1) {
            throw new Error("invalid number of songs to skip");
        } else if (numToSkip == 1) {
            skipMessage = `Skipping ${numToSkip} song`;
        } else {
            skipMessage = `Skipping ${numToSkip} songs`;
        }

        const player = this.playerManager.get(interaction.guild!.id);

        try {
            await player.forward(numToSkip);
            await interaction.reply({
                content: skipMessage,
                embeds: player.getCurrent() ? [buildPlayingMessageEmbed(player)] : [],
            });
        } catch (_: unknown) {
            throw new Error("no song to skip to");
        }
    }
}
