// Remotion project configuration (video/ is its own package; nothing here
// touches the repository root). The entry point and composition id are
// given on the command line by the package scripts.
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// The dataset and recorded captures live under video/public/ and are read
// with staticFile(); nothing is fetched from the network at render time.
Config.setPublicDir("./public");
