import dns from 'node:dns/promises'
import net from 'node:net'

// The in-app browser. Most websites refuse to be shown inside another page, so Smazy fetches the page
// itself and hands it to a sandboxed frame, with a small script that sends link clicks back through here.

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const MAX_HTML = 8 * 1024 * 1024
const MAX_REDIRECTS = 6

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
  }
  const lower = address.toLowerCase()
  if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7))
  return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower)
}

// Only public websites: never this computer or the local network.
async function checkPublic(url) {
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http and https pages can be opened.')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => { throw new Error(`Couldn’t find the site “${host}”.`) })
  if (addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error('That address is on this computer or the local network, so Smazy won’t open it.')
}

// Search-result links often pass through a redirect page; go straight to the real address.
function unwrap(url) {
  if (/(^|\.)duckduckgo\.com$/.test(url.hostname) && url.pathname === '/l/' && url.searchParams.get('uddg')) {
    try { return new URL(url.searchParams.get('uddg')) } catch { /* keep the original */ }
  }
  return url
}

async function fetchPage(start) {
  let url = unwrap(start)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await checkPublic(url)
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' },
    })
    const next = response.status >= 300 && response.status < 400 && response.headers.get('location')
    if (!next) return { url, response }
    await response.body?.cancel()
    url = unwrap(new URL(next, url))
  }
  throw new Error('That page redirected too many times.')
}

const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char])

// Runs inside the framed page: tells Smazy what loaded, and routes links and searches back through Smazy.
function bridge(realUrl) {
  return `<script>(function(){
var REAL=${JSON.stringify(realUrl).replace(/</g, '\\u003c')};
function tell(m){m.smazyBrowser=true;try{parent.postMessage(m,'*')}catch(e){}}
function go(u){tell({type:'navigate',url:u})}
document.addEventListener('click',function(e){
  if(e.button||e.metaKey||e.ctrlKey)return;
  var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(!a)return;
  var href=a.getAttribute('href')||'';
  if(/^\\s*(javascript|mailto|tel|data|blob):/i.test(href))return;
  if(href.charAt(0)==='#'){e.preventDefault();var id=decodeURIComponent(href.slice(1));var el=id&&(document.getElementById(id)||document.getElementsByName(id)[0]);if(el)el.scrollIntoView();else if(!id)scrollTo(0,0);return}
  var u;try{u=new URL(href,document.baseURI)}catch(x){return}
  if(!/^https?:$/.test(u.protocol))return;
  e.preventDefault();go(u.href)
},true);
document.addEventListener('submit',function(e){
  var f=e.target;if(!f||(f.getAttribute('method')||'get').toLowerCase()!=='get')return;
  var u;try{u=new URL(f.getAttribute('action')||REAL,document.baseURI)}catch(x){return}
  e.preventDefault();u.search=new URLSearchParams(new FormData(f)).toString();go(u.href)
},true);
document.addEventListener('keydown',function(e){if((e.metaKey||e.ctrlKey)&&e.code==='Backquote'){e.preventDefault();tell({type:'close'})}},true);
function loaded(){tell({type:'loaded',url:REAL,title:document.title||''})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',loaded);else loaded();
})();</script>`
}

function messagePage(url, heading, detail) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(heading)}</title>${bridge(url)}
<style>body{background:#f4f0e8;color:#193b5a;font:16px/1.5 system-ui,sans-serif;margin:0;padding:12vh 8vw}h1{font-size:22px;margin:0 0 8px}p{color:#5d6b7a;margin:0 0 6px;max-width:560px}</style></head>
<body><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(detail)}</p><p>You can also open it in a normal browser tab with the ↗ button above.</p></body></html>`
}

function prepareHtml(html, url) {
  // Scripts keep running, but the page's own rules about where it may be shown are dropped.
  let page = html.replace(/<meta[^>]+http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, '')
  let base = url.href
  const declared = page.match(/<base[^>]+href\s*=\s*["']?([^"'\s>]+)/i)
  if (declared) { try { base = new URL(declared[1], url).href } catch { /* keep the page address */ } }
  const head = `<base href="${escapeHtml(base)}"><meta name="referrer" content="no-referrer">${bridge(url.href)}`
  if (/<head[^>]*>/i.test(page)) return page.replace(/<head[^>]*>/i, (tag) => tag + head)
  if (/<html[^>]*>/i.test(page)) return page.replace(/<html[^>]*>/i, (tag) => `${tag}<head>${head}</head>`)
  return head + page
}

export async function browse(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const send = (status, html) => res.status(status).type('html').send(html)
  let target
  try { target = new URL(String(req.query.url || '')) } catch { return send(400, messagePage('', 'That doesn’t look like a web address', 'Check the address and try again.')) }
  try {
    const { url, response } = await fetchPage(target)
    const type = response.headers.get('content-type') || ''
    if (!/html|xml/i.test(type) && type) {
      // Pictures, PDFs and the like are passed straight through.
      res.status(response.status).setHeader('Content-Type', type)
      return res.send(Buffer.from(await response.arrayBuffer()))
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > MAX_HTML) return send(200, messagePage(url.href, 'This page is too large to show here', 'Smazy’s browser is a mini browser for quick look-ups.'))
    const charset = (type.match(/charset=([^;]+)/i)?.[1] || 'utf-8').trim().replace(/["']/g, '')
    let html
    try { html = new TextDecoder(charset).decode(bytes) } catch { html = bytes.toString('utf8') }
    send(200, prepareHtml(html, url))
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError'
    send(200, messagePage(target.href, timedOut ? 'That page took too long to answer' : 'Smazy couldn’t open that page', timedOut ? 'The site may be slow or offline.' : (error?.cause?.code === 'ENOTFOUND' ? 'The site wasn’t found.' : error?.message || 'Something went wrong.')))
  }
}
