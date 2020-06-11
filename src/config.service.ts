import {StructureChecker} from '@muhammetaliakbay/structure-check';
import {promises} from 'fs';
import {Observable, ReplaySubject} from 'rxjs';
import {distinctUntilChanged, map} from 'rxjs/operators';

export type ConfigModifier<CONF extends object> = (config: CONF) => Promise<CONF | void> | CONF | void;

export interface ConfigInitializer<CONF extends object> {
    (): Promise<CONF> | CONF;
}

export class ConfigService<CONF extends object> {
    private configJSONSubject = new ReplaySubject<string>(1);
    readonly configJSON$: Observable<string> = this.configJSONSubject.asObservable().pipe(
        distinctUntilChanged()
    );
    readonly config$: Observable<CONF> = this.configJSONSubject.pipe(
        map(confJSON => JSON.parse(confJSON))
    );

    constructor(
        readonly configFilePath: string,
        readonly configStructureCheck: StructureChecker<CONF>,
        readonly configInitializer: ConfigInitializer<CONF>
    ) {
    }

    async readConfig(): Promise<CONF> {
        let jsonText: string | null;
        try {
            jsonText = await promises.readFile(this.configFilePath, {encoding: 'utf8'})
        } catch (e) {
            jsonText = null;
        }
        let config: CONF;
        if (jsonText == null) {
            // no stored config found, initializing one
            config = await this.configInitializer();
            jsonText = JSON.stringify(config, null, 3);
            await this.writeConfig(config); // save initialized config
        } else {
            config = JSON.parse(jsonText);
        }
        if (!this.configStructureCheck(config)) {
            throw new Error('config doesn\'t fit into the desired structure');
        }
        this.configJSONSubject.next(jsonText);
        return config;
    }

    async writeConfig(config: CONF): Promise<void> {
        if (!this.configStructureCheck(config)) {
            throw new Error('writing config doesn\'t fit into the desired structure');
        }
        const jsonText = JSON.stringify(config, null, 3);
        await promises.writeFile(this.configFilePath, jsonText, {encoding: 'utf8'});
        this.configJSONSubject.next(jsonText);
    }

    async modifyConfig(modifier: ConfigModifier<CONF>): Promise<void> {
        const config = await this.readConfig();
        const modifiedConfig = await modifier(config) || config;
        await this.writeConfig(
            modifiedConfig
        );
    }
}
