import { Manager } from "./Manager";
import { Node } from "./Node";
import { Queue } from "./Queue";
import { Filters } from "../Static/Constants";
import {
    PlayerOptions,
    SearchQuery,
    SearchResult,
    TrackData,
    Snowflake
} from "../Static/Interfaces";

/**
 * The Player Class
 */
export class Player {

    /**
     * Queue for the player.
     * @type {Queue}
     */
    public queue: Queue = new Queue();

    /**
     * Boolean stating to repeat the track or not.
     * @type {boolean}
     */
    public trackRepeat = false;

    /**
     * Boolean stating to repeat the queue or not.
     * @type {boolean}
     */
    public queueRepeat = false;

    /**
     * Boolean stating is the player playing or not.
     * @type {boolean}
     */
    public playing = false;

    /**
     * The volume of the player.
     * @type {number}
     */
    public volume: number;

    /**
     * The node of the player.
     * @type {Node}
     */
    public node: Node;

    /**
     * Guild ID.
     * @type Snowflake
     */
    public guild: Snowflake;

    /**
     * The voice channel.
     * @type {string}
     */
    public voiceChannel: string | null = null;

    /**
     * The text channel for the player.
     * @type {string}
     */
    public textChannel: string | null = null;

    /** The Manager of the player.
     * @type {Manager}
     */
    public manager: Manager;

    /**
     * Static manager of the player.
     * @ignore
     * @private
     */
    private static _manager: Manager;

    /**
     * The current state of the player.
     * idle - Not connected yet.
     * connected - Connected to the player.
     * disconnected - Was connected to the player.
     * connecting - Connecting to the player.
     * 
     * @type {"connected" | "disconnected" | "connecting"}
     * @hidden
     * @ignore
     */
    public state: "connected" | "disconnected" | "connecting" = "connecting";

    /**
     * Creates a new player instance.
     * 
     * @param {PlayerOptions} options The options nexessary for the player.
     * @hideconstructor
     */
    constructor(options: PlayerOptions) {
        if (!this.manager) this.manager = Player._manager;
        if (!this.manager) throw new RangeError("Manager has not been initiated.");
        if (this.manager.players.has(options.guild)) return this.manager.players.get(options.guild);

        this.guild = options.guild;
        this.node = this.manager.node;
        if (options.voiceChannel) this.voiceChannel = options.voiceChannel;
        if (options.textChannel) this.textChannel = options.textChannel;
        if (!this.node) throw new RangeError("No available nodes.");

        this.manager.players.set(options.guild, this);
        this.setVolume(options.volume ?? 100);
        this.connect();
    }

    /**
     * Boolean stating is the player connected or not.
     * @readonly
     */
    public get connected(): boolean {
        return this.state == "connected";
    }

    /**
     * Boolean stating is the player paused or not.
     * @readonly
     */
    public get paused(): boolean {
        return this.connected && !this.playing;
    }

    /**
     * Initialize the static manager for the player.
     * 
     * @returns {void}
     * @param {Manager} manager The static manager to set.
     * @ignore
     */
    public static initStaticManager(manager: Manager)  {
        this._manager = manager;
    }

    /**
     * Search youtube for songs and playlists.
     * 
     * @param {SearchQuery} searchQuery The search query options object.
     * @param {Snowflake} requestor The id of the user who requested it.
     * @returns {SearchResult}
     * @example
     * const results = await player.search({ query: "Play that funky music" }, message.author);
     * console.log(results);
     */
    public search(searchQuery: SearchQuery, requestor: Snowflake): Promise<SearchResult> {
        return this.manager.search(searchQuery, requestor);
    }

    /**
     * Create a voice channel Subscription to nexus.
     * @returns {Promise<void>}
     */
    public async connect()  {
        if (!this.voiceChannel) throw new RangeError("No voice channel has been set.");
        await this.node.makeRequest("POST",`api/subscription/${this.guild}/${this.voiceChannel}`);
        this.state = "connecting";
    }

    /**
     * Disconnects the voice channel.
     * @returns {Promise<void>}
     */
    public async disconnect(): Promise<this> {
        if (!this.voiceChannel) return this;
        if (this.playing) this.stop();
        await this.node.makeRequest("DELETE", `api/subscription/${this.guild}/${this.voiceChannel}`);
        this.voiceChannel = null;
        this.state = "disconnected";
    }

    /**
     * Play the songs added in the queue.
     * @returns {Promise<void>}
     */
    public async play() {
        if (!this.queue.current) throw new RangeError("Queue is empty!");
        if (this.state == "disconnected") await this.connect();
        
        return await new Promise((resolve, reject) => {
            const connectInterval = setInterval(() => {
                if (this.connected) {
                    this.sendPlayPost(this.queue.current);
                    return resolve(null);
                }

                clearInterval(connectInterval);
                reject(new Error(`Timed out to play the player because the player's state is still ${this.state}.`));
            }, 1000);
        });
    }

    /**
     * Send POST request to NEXUS to play the song.
     * 
     * @param {TrackData} track Track to Play the song
     * @private
     */
    private async sendPlayPost(track: TrackData) {
        await this.node.makeRequest("POST", `api/player/${this.guild}`, { track: { url: track.url } })
        this.playing = true;
    }

    /**
     * Apply filters through the Nexus API.
     * @param {Filters} filter Music Filter to Apply
     */
    public applyFilters(filter: Filters) {
        return this.node
            .makeRequest("PATCH", `api/player/${this.guild}`, { data: { encoder_args: ["-af", filter] } })
            .then(res => {
                if (!res.ok) this.manager.emit("playerError", res);
            });
    }

    /**
     * Set the volume of the player.
     * @param {number} volume Volume to set.
     * @returns {Promise<void>}
     */
    public async setVolume(volume: number)  {
        this.volume = volume;
        await this.node.makeRequest("PATCH", `api/player/${this.guild}`, { data: { volume: this.volume } });
    }

    /**
     * Destroy the player.
     * @returns {Promise<void>}
     */
    public async destroy()  {
        if (this.playing) await this.stop();
        await this.disconnect();
        this.manager.emit("playerDestroy", this);
        this.manager.players.delete(this.guild);
    }

    /**
     * Clear the queue and stop the player.
     * @returns {Promise<void>}
     */
    public async stop()  {
        this.queue.current = null;
        this.queue.previous = null;
        this.queue.clear();
        this.playing = false;
        await this.skip();
        await this.destroy();
    }

    /**
     * Skip the current playing song.
     * @returns {Promise<void>}
     */
    public async skip() {
        await this.node.makeRequest("DELETE", `api/player/${this.guild}`);
    }

    /**
     * Pause the player.
     * @returns {Promise<void>}
     */
    public async pause() {
        if (this.paused) return;
        this.playing = false;
        await this.node.makeRequest("PATCH", `api/player/${this.guild}`, { data: { paused: true } });
    }

    /**
     * Resume the player.
     * @returns {Promise<void>}
     */
    public async resume() {
        if (this.playing) return;
        this.playing = true;
        await this.node.makeRequest("PATCH", `api/player/${this.guild}`, { data: { paused: false } });
    }

}

/**
 * @typedef {Object} PlayerOptions
 * @param {Snowflake} guild ID of the guild
 * @param {Snowflake} textChannel ID of text channel
 * @param {Snowflake} voiceChannel ID of voice channel
 * @param {number} [volume] Initial volume
 */

/**
 * The available audio filters
 * @typedef {string} Filters
 * @property {string} bassboost The bassboost filter
 * @property {string} 8D The 8D filter
 * @property {string} vaporwave The vaporwave filter
 * @property {string} nightcore The nightcore filter
 * @property {string} phaser The phaser filter
 * @property {string} tremolo The tremolo filter
 * @property {string} vibrato The vibrato filter
 * @property {string} reverse The reverse filter
 * @property {string} treble The treble filter
 * @property {string} normalizer The normalizer filter
 * @property {string} surrounding The surrounding filter
 * @property {string} pulsator The pulsator filter
 * @property {string} subboost The subboost filter
 * @property {string} karaoke The karaoke filter
 * @property {string} flanger The flanger filter
 * @property {string} gate The gate filter
 * @property {string} haas The haas filter
 * @property {string} mcompand The mcompand filter
 * @property {string} mono The mono filter
 * @property {string} mstlr The mstlr filter
 * @property {string} mstrr The mstrr filter
 * @property {string} chorus The chorus filter
 * @property {string} chorus2d The chorus2d filter
 * @property {string} chorus3d The chorus3d filter
 * @property {string} fadein The fadein filter
 * @property {string} compressor The compressor filter
 * @property {string} expander The expander filter
 * @property {string} softlimiter The softlimiter filter
 */