import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 빌드 결과를 dist/index.html 하나로 묶어서, 더블클릭만으로도 실행되게 한다.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { chunkSizeWarningLimit: 2000 },
});
