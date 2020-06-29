import {StructureChecker} from '@muhammetaliakbay/structure-check';
import {promises} from 'fs';
import {Observable, ReplaySubject} from 'rxjs';
import {distinctUntilChanged, map} from 'rxjs/operators';
import * as YAML from 'yaml';

/**
 * Handler type definition for modifying live config object before save
 * @typeParam CONF - Configuration object structure
 */
export interface ConfigModifier<CONF extends object> {
    /**
     * @param config - Input configuration object to get modified
     * @returns Returns void if modification is directly done on input value, else returns a new object which is getting saved. All the returns can be promisified.
     */
    (config: CONF): Promise<CONF | void> | CONF | void;
}

/**
 * Handle type definition for creating a new instance of first initialized configuration object.
 * @typeParam CONF - Configuration object structure
 */
export interface ConfigInitializer<CONF extends object> {
    /**
     * @returns Returns a new configuration object instance to be saved for first. Result can be promisified.
     */
    (): Promise<CONF> | CONF;
}

/**
 * Very essential config-service implementation. Makes reads and writes on configuration files.
 * Identifies which format to use by file extension. ".json" for JSON, ".yml" or ".yaml" for YAML, JSON for any else.
 * @typeParam CONF - Configuration object structure
 */
export class ConfigService<CONF extends object> {
    private format: 'json' | 'yaml';
    private configTextSubject = new ReplaySubject<string>(1);

    private stringify(conf: CONF): string {
        if (this.format === 'json') {
            return JSON.stringify(conf, null, 3);
        } else if (this.format === 'yaml') {
            return YAML.stringify(conf, {
                indent: 3
            });
        } else {
            throw new Error('Bug.');
        }
    }
    private parse(text: string): any {
        if (this.format === 'json') {
            return JSON.parse(text);
        } else if (this.format === 'yaml') {
            return YAML.parse(text);
        } else {
            throw new Error('Bug.');
        }
    }

    /**
     * Emits flat version of latest saved configuration
     */
    readonly configText$: Observable<string> = this.configTextSubject.asObservable().pipe(
        distinctUntilChanged()
    );
    /**
     * Emits latest version of saved configuration object
     */
    readonly config$: Observable<CONF> = this.configTextSubject.pipe(
        map(confText => this.parse(confText))
    );

    /**
     * Creates a new instance of ConfigService
     * @param configFilePath - File path to save flattened configuration
     * @param configStructureCheck - Structure-Checker of the desired configuration object structure
     * @param configInitializer - Initializer handler for first configuration object if needed
     */
    constructor(
        readonly configFilePath: string,
        readonly configStructureCheck: StructureChecker<CONF>,
        readonly configInitializer: ConfigInitializer<CONF>
    ) {
        const lowerCaseFilePath = configFilePath.toLowerCase();
        if (lowerCaseFilePath.endsWith('.json')) {
            this.format = 'json';
        } else if(lowerCaseFilePath.endsWith('.yaml') || lowerCaseFilePath.endsWith('.yml')) {
            this.format = 'yaml';
        } else {
            this.format = 'json';
        }
    }

    /**
     * Reads flat config text from file at "this.configFilePath". If file doesn't exists creates a new configuration object instance by calling "this.configInitializer".
     * @returns Returns an async result of readed, parsed and checked configuration object structure
     */
    async readConfig(): Promise<CONF> {
        let flatText: string | null;
        try {
            flatText = await promises.readFile(this.configFilePath, {encoding: 'utf8'})
        } catch (e) {
            flatText = null;
        }
        let config: CONF;
        if (flatText == null) {
            // no stored config found, initializing one
            config = await this.configInitializer();
            flatText = this.stringify(config);
            await this.writeConfig(config); // save initialized config
        } else {
            config = this.parse(flatText);
        }
        if (!this.configStructureCheck(config)) {
            throw new Error('config doesn\'t fit into the desired structure');
        }
        this.configTextSubject.next(flatText);
        return config;
    }

    /**
     * Validates input config file, flattens it and saves the flat text into the file at "this.configFilePath".
     * @param config - Input configuration object to get flattened and saved.
     * @returns Returns a promise which gets resolved when file saving is done.
     */
    async writeConfig(config: CONF): Promise<void> {
        if (!this.configStructureCheck(config)) {
            throw new Error('writing config doesn\'t fit into the desired structure');
        }
        const flatText = this.stringify(config);
        await promises.writeFile(this.configFilePath, flatText, {encoding: 'utf8'});
        this.configTextSubject.next(flatText);
    }

    /**
     * Reads a fresh config object, modifies it by calling "modifier", then validates it and saves.
     * @param modifier - Modify handler to be called before saving fresh config object for modifying it
     * @returns Returns a promise which gets resolved when file saving is done.
     */
    async modifyConfig(modifier: ConfigModifier<CONF>): Promise<void> {
        const config = await this.readConfig();
        const modifiedConfig = await modifier(config) || config;
        await this.writeConfig(
            modifiedConfig
        );
    }
}
