import {
  ConfigPlugin,
  ExportedConfig,
  ExportedConfigWithProps,
  ModPlatform,
} from '../Plugin.types';
import { BaseModOptions, withBaseMod } from './withMod';

export type ForwardedBaseModOptions = Partial<
  Pick<BaseModOptions, 'saveToInternal' | 'skipEmptyMod'>
>;

export type BaseModProviderMethods<
  ModType,
  Props extends ForwardedBaseModOptions = ForwardedBaseModOptions
> = {
  getFilePath: (config: ExportedConfigWithProps<ModType>, props: Props) => Promise<string> | string;
  read: (
    filePath: string,
    config: ExportedConfigWithProps<ModType>,
    props: Props
  ) => Promise<ModType> | ModType;
  write: (
    filePath: string,
    config: ExportedConfigWithProps<ModType>,
    props: Props
  ) => Promise<void> | void;
};

export type CreateBaseModProps<
  ModType,
  Props extends ForwardedBaseModOptions = ForwardedBaseModOptions
> = {
  methodName: string;
  platform: ModPlatform;
  modName: string;
} & BaseModProviderMethods<ModType, Props>;

export function createBaseMod<
  ModType,
  Props extends ForwardedBaseModOptions = ForwardedBaseModOptions
>({
  methodName,
  platform,
  modName,
  getFilePath,
  read,
  write,
}: CreateBaseModProps<ModType, Props>): ConfigPlugin<Props | void> {
  const withUnknown: ConfigPlugin<Props | void> = (config, _props) => {
    const props = _props || ({} as Props);
    return withBaseMod<ModType>(config, {
      platform,
      mod: modName,
      skipEmptyMod: props.skipEmptyMod ?? true,
      saveToInternal: props.saveToInternal ?? false,
      isProvider: true,
      async action({ modRequest: { nextMod, ...modRequest }, ...config }) {
        try {
          let results: ExportedConfigWithProps<ModType> = {
            ...config,
            modRequest,
          };

          const filePath = await getFilePath(results, props);

          const modResults = await read(filePath, results, props);

          results = await nextMod!({
            ...results,
            modResults,
            modRequest,
          });

          assertModResults(results, modRequest.platform, modRequest.modName);

          await write(filePath, results, props);
          return results;
        } catch (error) {
          error.message = `[${platform}.${modName}]: ${methodName}: ${error.message}`;
          throw error;
        }
      },
    });
  };

  if (methodName) {
    Object.defineProperty(withUnknown, 'name', {
      value: methodName,
    });
  }

  return withUnknown;
}

export function assertModResults(results: any, platformName: string, modName: string) {
  // If the results came from a mod, they'd be in the form of [config, data].
  // Ensure the results are an array and omit the data since it should've been written by a data provider plugin.
  const ensuredResults = results;

  // Sanity check to help locate non compliant mods.
  if (!ensuredResults || typeof ensuredResults !== 'object' || !ensuredResults?.mods) {
    throw new Error(
      `Mod \`mods.${platformName}.${modName}\` evaluated to an object that is not a valid project config. Instead got: ${JSON.stringify(
        ensuredResults
      )}`
    );
  }
  return ensuredResults;
}

function upperFirst(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function createPlatformBaseMod<
  ModType,
  Props extends ForwardedBaseModOptions = ForwardedBaseModOptions
>({ modName, ...props }: Omit<CreateBaseModProps<ModType, Props>, 'methodName'>) {
  // Generate the function name to ensure it's uniform and also to improve stack traces.
  const methodName = `with${upperFirst(props.platform)}${upperFirst(modName)}BaseMod`;
  return createBaseMod<ModType, Props>({
    methodName,
    modName,
    ...props,
  });
}

export function provider<ModType, Props extends ForwardedBaseModOptions = ForwardedBaseModOptions>(
  props: BaseModProviderMethods<ModType, Props>
) {
  return props;
}

export function withGeneratedBaseMods<ModName extends string>(
  config: ExportedConfig,
  {
    platform,
    providers,
    ...props
  }: ForwardedBaseModOptions & {
    platform: ModPlatform;
    providers: Partial<Record<ModName, BaseModProviderMethods<any, any>>>;
  }
): ExportedConfig {
  return Object.entries(providers).reduce((config, [modName, value]) => {
    const baseMod = createPlatformBaseMod({ platform, modName, ...(value as any) });
    return baseMod(config, props);
  }, config);
}
