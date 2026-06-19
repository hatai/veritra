import { defineConfig } from "vite-plus";

export default defineConfig({
  test: { environment: "node", globals: true },
  lint: {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@libsql/client",
              message:
                "Workers-compat: always import from '@libsql/client/web', never the bare specifier or '/node' subpath.",
            },
            {
              name: "@libsql/client/node",
              message:
                "Workers-compat: always import from '@libsql/client/web', never the bare specifier or '/node' subpath.",
            },
          ],
        },
      ],
    },
  },
});
