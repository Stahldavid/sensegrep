import fs from "fs/promises";
import os from "os";
import path from "path";
import { xdgCache, xdgConfig, xdgData, xdgState } from "xdg-basedir";

const app = "sensegrep";

const data = path.join(xdgData!, app);
const cache = path.join(xdgCache!, app);
const config = path.join(xdgConfig!, app);
const state = path.join(xdgState!, app);

export namespace Global {
  export const Path = {
    home: os.homedir(),
    data,
    bin: path.join(data, "bin"),
    log: path.join(data, "log"),
    cache,
    config,
    state,
  } as const;
}

await Promise.all([
  fs.mkdir(Global.Path.data, { recursive: true }),
  fs.mkdir(Global.Path.cache, { recursive: true }),
  fs.mkdir(Global.Path.config, { recursive: true }),
  fs.mkdir(Global.Path.state, { recursive: true }),
  fs.mkdir(Global.Path.log, { recursive: true }),
  fs.mkdir(Global.Path.bin, { recursive: true }),
]);

const CACHE_VERSION = "1";

const version = await fs.readFile(path.join(Global.Path.cache, "version"), "utf8").catch(() => "0");

if (version !== CACHE_VERSION) {
  try {
    const contents = await fs.readdir(Global.Path.cache);
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Global.Path.cache, item), {
          recursive: true,
          force: true,
        }),
      ),
    );
  } catch (e) {}
  await fs.writeFile(path.join(Global.Path.cache, "version"), CACHE_VERSION);
}
