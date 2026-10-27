# Browser checks for the GitHub Pages copy.
# Setup (see README "GitHub page"): server on :3000 with
# PUBLIC_SITE_ORIGINS=http://localhost:8080, Pages build served at
# http://localhost:8080/portfolio-studio-site/ (LIVE_API_URL=http://localhost:3000),
# and a second build pointing at the slow proxy on :3001 served at /slow/.
import asyncio, json, os, subprocess, sys, time, urllib.request
from playwright.async_api import async_playwright

PAGES = 'http://localhost:8080/portfolio-studio-site/'
SLOW = 'http://localhost:8080/slow/'
API = 'http://localhost:3000'
results = []
def check(name, cond):
    results.append(('PASS' if cond else 'FAIL') + '  ' + name)

def api(method, path, body=None, cookie=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json', 'X-Requested-With': 'portfolio-admin', **({'Cookie': cookie} if cookie else {})})
    with urllib.request.urlopen(req) as r:
        return r.headers, json.loads(r.read() or b'null')

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        errs = []
        pg = await b.new_page(viewport={'width': 1280, 'height': 860})
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(PAGES); await pg.wait_for_timeout(1500)
        check('live: page shows published name', 'Ramathota Vinay' in await pg.inner_text('#hero-name'))
        check('live: avatar image loads', await pg.evaluate("(()=>{const i=document.querySelector('.avatar-wrap img');return !!i&&i.complete&&i.naturalWidth>0})()"))
        check('live: fonts load from the Pages path', await pg.evaluate("document.fonts.check('700 40px \"Bricolage Grotesque\"')"))
        check('live: favicon points at the live server', API in await pg.get_attribute('#favicon', 'href'))

        # Admin edit appears on the GitHub page without rebuilding.
        h, _ = api('POST', '/api/auth/login', {'username': 'admin_context', 'password': 'Default-pass-58'})
        cookie = h.get('Set-Cookie').split(';')[0]
        _, profiles = api('GET', '/api/admin/profiles', cookie=cookie)
        live = [x for x in profiles if x['status'] == 'published'][0]
        _, rec = api('GET', f"/api/admin/profiles/{live['id']}", cookie=cookie)
        rec['data']['displayName'] = 'Vinay R. (edited)'
        api('PUT', f"/api/admin/profiles/{live['id']}", {'data': rec['data']}, cookie=cookie)
        await pg.reload(); await pg.wait_for_timeout(1500)
        check('auto update: admin edit shows after reload', 'Vinay R. (edited)' in await pg.inner_text('#hero-name'))

        # Contact form posts cross-origin to the live server.
        await pg.fill('#name', 'Pages visitor'); await pg.fill('#email', 'visitor@example.com'); await pg.fill('#message', 'Sent from the GitHub page.')
        await pg.click('#contact button[type=submit]'); await pg.wait_for_timeout(1000)
        check('contact form works from GitHub page', 'Message sent' in await pg.inner_text('.form-status'))
        _, msgs = api('GET', '/api/admin/messages', cookie=cookie)
        check('message reached the admin inbox', any(m['email'] == 'visitor@example.com' for m in msgs))

        # Slow wake: proxy delays the live answer 8 s -> snapshot first, then live.
        sl = await b.new_page(viewport={'width': 1280, 'height': 860})
        t0 = time.time()
        await sl.goto(SLOW)
        await sl.wait_for_function("document.querySelector('#hero-name').textContent.length > 3", timeout=15000)
        t_first = time.time() - t0
        first = await sl.inner_text('#hero-name')
        check(f'slow wake: snapshot shown first ({t_first:.1f}s)', first == 'Ramathota Vinay' and t_first < 7.5)
        await sl.wait_for_function("document.querySelector('#hero-name').textContent.includes('edited')", timeout=20000)
        check('slow wake: switches to live content', True)

        print('\n'.join(results)); print('errors:', errs)
        await b.close()

asyncio.run(main())
