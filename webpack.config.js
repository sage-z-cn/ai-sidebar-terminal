const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");

// Two stable tokens for the VS Code watch problemMatcher in tasks.json:
// beginsPattern on "watch build started", endsPattern on "extension bundle ready"
// so preLaunchTask waits only until dist/extension.js is written.
class ExtensionReadyPlugin {
  apply(compiler) {
    compiler.hooks.watchRun.tap("ExtensionReadyPlugin", () => {
      console.log("ai-sidebar-terminal: webpack watch build started");
    });
    compiler.hooks.done.tap("ExtensionReadyPlugin", () => {
      console.log("ai-sidebar-terminal: extension bundle ready");
    });
  }
}

const extensionConfig = {
  target: "node",
  mode: "none",
  entry: "./src/extension.ts",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "extension.js",
    libraryTarget: "commonjs2",
  },
  externals: {
    vscode: "commonjs vscode",
    "node-pty": "commonjs node-pty",
    // Optional native accelerators for `ws`; not installed on purpose.
    // Keeping the require() calls unresolved makes them throw at runtime so
    // ws's own try/catch falls back to its pure-JS implementations. (Do NOT
    // alias these to false: webpack 5 resolves that to an empty module, so
    // the require succeeds with `{}` and bufferUtil.unmask is undefined.)
    bufferutil: "commonjs bufferutil",
    "utf-8-validate": "commonjs utf-8-validate",
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: [
          /node_modules/,
          /example-projects/,
          /\.test\.ts$/,
          /src\/test\//,
          /src\/\__tests__\//,
        ],
        use: [
          {
            loader: "ts-loader",
          },
        ],
      },
      {
        test: /\.html$/,
        resourceQuery: /raw/,
        type: "asset/source",
      },
    ],
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, "l10n").replace(/\\/g, "/"),
          to: path.resolve(__dirname, "dist/l10n"),
          noErrorOnMissing: true,
        },
      ],
    }),
    new ExtensionReadyPlugin(),
  ],
  devtool: "nosources-source-map",
  infrastructureLogging: {
    level: "log",
  },
};

const webviewConfig = {
  target: "web",
  mode: "none",
  entry: {
    main: "./src/webview/main.ts",
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: (pathData) => {
      if (pathData.chunk.name === "main") {
        return "webview.js";
      }
      return "[name].js";
    },
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
    fallback: {
      path: false,
      fs: false,
    },
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: [
          /node_modules/,
          /example-projects/,
          /\.test\.ts$/,
          /src\/test\//,
          /src\/\__tests__\//,
        ],
        use: [
          {
            loader: "ts-loader",
          },
        ],
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        {
          context: path.resolve(__dirname, "src/webview").replace(/\\/g, "/"),
          from: "*.css",
          to: path.resolve(__dirname, "dist"),
        },
        {
          context: path.resolve(__dirname, "src/webview").replace(/\\/g, "/"),
          from: "*.html",
          to: path.resolve(__dirname, "dist"),
        },
        {
          context: path.resolve(__dirname, "src/webview").replace(/\\/g, "/"),
          from: "**/*.css",
          to: path.resolve(__dirname, "dist"),
        },
      ],
    }),
  ],
  devtool: "nosources-source-map",
  performance: { hints: false },
};

module.exports = [extensionConfig, webviewConfig];
