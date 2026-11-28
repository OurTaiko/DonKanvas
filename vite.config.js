import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import { parse, serialize } from 'parse5';
import { getIntroPath, getPageMetadata, getPageURL, pageLocales, getPageMetaTags, getApplicationMetadata } from './src/locales.js';
import { renderIntroPage, renderSitemap } from './src/seo-pages.js';

function localizePage(html, code) {
  const document = parse(html);
  const metadata = getPageMetadata(code);
  const values = getPageMetaTags(code);
  function visit(node) {
    const attributes = Object.fromEntries((node.attrs || []).map(attribute => [attribute.name, attribute.value]));
    const setAttribute = (name, value) => {
      const attribute = node.attrs.find(item => item.name === name);
      if (attribute) attribute.value = value;
      else node.attrs.push({ name, value });
    };
    const setText = value => { node.childNodes = [{ nodeName: '#text', value, parentNode: node }]; };
    if (node.tagName === 'html') setAttribute('lang', code);
    if (node.tagName === 'title') setText(metadata.title);
    if (node.tagName === 'meta' && values[attributes.name || attributes.property] !== undefined) setAttribute('content', values[attributes.name || attributes.property]);
    if (node.tagName === 'link' && attributes.rel === 'canonical') setAttribute('href', getPageURL(code));
    if (node.tagName === 'script' && attributes.type === 'application/ld+json') {
      const application = JSON.parse(node.childNodes.map(child => child.value).join(''));
      Object.assign(application, getApplicationMetadata(code));
      setText(JSON.stringify(application));
    }
    if (node.tagName === 'head') {
      for (const language of [...Object.keys(pageLocales), 'x-default']) {
        node.childNodes.push({
          nodeName: 'link', tagName: 'link', namespaceURI: 'http://www.w3.org/1999/xhtml', parentNode: node, childNodes: [],
          attrs: [
            { name: 'rel', value: 'alternate' },
            { name: 'hreflang', value: language },
            { name: 'href', value: getPageURL(language === 'x-default' ? 'zh-CN' : language) }
          ]
        });
      }
    }
    for (const child of node.childNodes || []) visit(child);
  }
  visit(document);
  return serialize(document);
}

function localizedPages() {
  return {
    name: 'localized-seo-pages',
    enforce: 'post',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!['GET', 'HEAD'].includes(request.method)) return next();
        const path = request.url.split('?')[0].slice(1);
        const code = Object.keys(pageLocales).find(language => getIntroPath(language) === path);
        if (!code && path !== 'sitemap.xml') return next();
        response.setHeader('Content-Type', code ? 'text/html; charset=utf-8' : 'application/xml; charset=utf-8');
        response.end(request.method === 'HEAD' ? '' : code ? renderIntroPage(code) : renderSitemap());
      });
    },
    generateBundle(_options, bundle) {
      const html = String(bundle['index.html'].source);
      bundle['index.html'].source = localizePage(html, 'zh-CN');
      for (const code of Object.keys(pageLocales).filter(code => code !== 'zh-CN')) {
        this.emitFile({ type: 'asset', fileName: `index.${code}.html`, source: localizePage(html, code) });
      }
      for (const code of Object.keys(pageLocales)) {
        this.emitFile({ type: 'asset', fileName: getIntroPath(code), source: renderIntroPage(code) });
      }
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: renderSitemap() });
    }
  };
}

const defaultMetadata = getPageMetadata('zh-CN');

export default defineConfig({
  base: './',
  plugins: [
    vue(),
    localizedPages(),
    VitePWA({
      injectRegister: 'script',
      registerType: 'prompt',
      includeAssets: ['icons/*.png'],
      manifest: {
        id: './',
        name: defaultMetadata.name,
        short_name: defaultMetadata.name,
        description: defaultMetadata.applicationDescription,
        lang: 'zh-CN',
        start_url: './',
        scope: './',
        display: 'fullscreen',
        theme_color: '#16745b',
        background_color: '#f5f7f4',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,webmanifest}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/media\//, /^[^?]*\/storage-callback\.html(?:\?|$)/],
        cleanupOutdatedCaches: true,
        skipWaiting: false,
        clientsClaim: false
      }
    })
  ],
  server: { host: '127.0.0.1', port: 4173 },
  preview: { host: '127.0.0.1', port: 4173 }
});