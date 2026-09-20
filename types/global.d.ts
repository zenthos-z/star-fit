interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_BUILD_TS?: string;
  readonly VITE_PKG_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
