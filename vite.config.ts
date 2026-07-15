import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Honour PORT so the dev server can be placed on an assigned port.
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: false,
  },
});
