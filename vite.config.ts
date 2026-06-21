import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    allowedHosts: true,
    hmr: {
      overlay: false,
    },
    watch: {
      ignored: [
        "**/.venv/**",
        "**/runtime/**",
        "**/deploy/backups/**",
        "**/deploy/secrets/**",
        "**/ticketing_warehouse/target/**",
        "**/*.duckdb",
        "**/*.duckdb.wal",
      ],
    },
    proxy: {
      "/api/analytics": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: pathValue => pathValue.replace(/^\/api\/analytics/, ""),
      },
      "/functions": {
        target: "http://127.0.0.1:54321",
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
}));
