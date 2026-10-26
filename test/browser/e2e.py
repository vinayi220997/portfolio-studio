# Browser end-to-end checks. Start the server on :3000 with a FRESH database and
# this .env: ADMIN_BOOTSTRAP_ID=admin_context, ADMIN_BOOTSTRAP_PASSWORD=Default-pass-58,
# ADMIN_RECOVERY_CODE=RECOVERY-CODE-2. Then: python3 test/browser/e2e.py
import asyncio, json
from playwright.async_api import async_playwright
import os, tempfile
SP=os.environ.get('SHOT_DIR', tempfile.gettempdir())+'/'
B='http://localhost:3000'
results=[]
def check(name, cond):
    results.append(('PASS' if cond else 'FAIL')+'  '+name)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width':1280,'height':860}, permissions=['clipboard-read','clipboard-write'])
        errs=[]
        site = await ctx.new_page()
        site.on('pageerror', lambda e: errs.append('SITE '+str(e)))
        await site.goto(B+'/'); await site.wait_for_timeout(1200)
        # typing animation runs
        t1 = await site.inner_text('.titles'); await site.wait_for_timeout(900); t2 = await site.inner_text('.titles')
        check('typing animation changes text', t1 != t2)
        # copy email
        await site.click('#contact .copy-btn'); await site.wait_for_timeout(200)
        check('copy shows "Email copied!"', 'Email copied!' in await site.inner_text('#contact .copy-btn'))
        clip = await site.evaluate('navigator.clipboard.readText()')
        check('clipboard has the e-mail', clip == 'vinayi220997@gmail.com')
        await site.wait_for_timeout(2500)
        check('copy button reverts', (await site.inner_text('#contact .copy-btn')).strip() == 'Copy')
        # contact form errors then success
        await site.click('#contact button[type=submit]'); await site.wait_for_timeout(500)
        check('form shows field errors', await site.is_visible('#email-err'))
        await site.fill('#name','Test Recruiter'); await site.fill('#email','recruiter@example.com'); await site.fill('#subject','Role at Acme'); await site.fill('#message','Hi Vinay, are you open to a UI/UX role?')
        await site.click('#contact button[type=submit]'); await site.wait_for_timeout(700)
        check('form success message', 'Message sent' in await site.inner_text('.form-status'))
        # theme toggle for visitor
        await site.click('#mode-btn'); await site.wait_for_timeout(200)
        th = await site.evaluate('document.documentElement.dataset.theme')
        check('visitor theme toggle works', th in ('light','dark'))

        adm = await ctx.new_page()
        adm.on('pageerror', lambda e: errs.append('ADMIN '+str(e)))
        await adm.goto(B+'/admin/'); await adm.wait_for_timeout(700)
        check('first-login credentials shown', await adm.is_visible('text=First sign-in'))
        await adm.fill('#login-id','admin_context'); await adm.fill('#login-pw','Default-pass-58')
        await adm.click('button:has-text("Sign in")'); await adm.wait_for_timeout(900)
        check('signed in, default-password card visible', await adm.is_visible('.side-notices >> text=The default password is still in use.'))
        # inbox has the message, reply fails clearly (email not configured)
        await adm.goto(B+'/admin/#/inbox'); await adm.wait_for_timeout(700)
        check('unread badge shows 1', (await adm.inner_text('#unread')).strip() == '1')
        await adm.click('.msg-row'); await adm.wait_for_timeout(700)
        await adm.fill('textarea[aria-label="Your reply"]', 'Thanks! Yes, I am.')
        await adm.click('button:has-text("Send reply")'); await adm.wait_for_timeout(700)
        check('reply error explains e-mail setup', 'not set up' in (await adm.inner_text('.composer .form-error')))
        # profiles: duplicate profile then publish -> confirm replace
        await adm.goto(B+'/admin/#/profiles'); await adm.wait_for_timeout(600)
        await adm.click('.profile-row >> nth=0 >> button:has-text("Duplicate")'); await adm.wait_for_timeout(700)
        check('profile duplicated as draft', await adm.locator('.profile-row').count() == 2)
        await adm.click('.profile-row >> nth=1 >> button:has-text("Publish")'); await adm.wait_for_timeout(500)
        check('publish asks to replace live profile', await adm.is_visible('dialog >> text=will replace it'))
        await adm.click('dialog >> button:has-text("Publish and replace")'); await adm.wait_for_timeout(700)
        live = await adm.locator('.profile-row.is-live .profile-name').inner_text()
        check('copy is now the live one', 'copy' in live)
        # edit the live copy: change display name, duplicate a project card (draft), save
        await adm.click('.profile-row.is-live >> text=Edit'); await adm.wait_for_timeout(700)
        await adm.click('role=tab[name=/Basics/]'); await adm.wait_for_timeout(200)
        dn = adm.locator('.card >> nth=0 >> input >> nth=0')
        await dn.fill('Vinay Ramathota')
        await adm.click('role=tab[name=/Projects/]'); await adm.wait_for_timeout(300)
        await adm.click('details.item >> nth=0 >> summary')
        await adm.click('details.item >> nth=0 >> button:has-text("Duplicate")'); await adm.wait_for_timeout(300)
        check('duplicated card is a draft', 'Draft' in await adm.locator('details.item >> nth=1 >> .badge').inner_text())
        await adm.click('button:has-text("Save changes")'); await adm.wait_for_timeout(800)
        pub = await (await ctx.request.get(B+'/api/public/site')).json()
        check('site shows new name', pub['profile']['displayName']=='Vinay Ramathota')
        check('draft card not public', len(pub['profile']['projects'])==6)
        # theme
        await adm.goto(B+'/admin/#/appearance'); await adm.wait_for_timeout(600)
        await adm.click('label.seg-opt:has-text("Dark")')
        await adm.click('button[aria-label="Use #6D4AFF"]')
        await adm.click('label.seg-opt:has-text("Gradient")')
        await adm.click('button:has-text("Save theme")'); await adm.wait_for_timeout(600)
        pub = await (await ctx.request.get(B+'/api/public/site')).json()
        check('theme saved', pub['theme']['mode']=='dark' and pub['theme']['accent']=='#6D4AFF' and pub['theme']['background']['type']=='gradient')
        s2 = await ctx.new_page()
        await s2.evaluate("()=>{}")
        await s2.goto(B+'/'); await s2.evaluate("localStorage.removeItem('ps-visitor-mode')"); await s2.reload(); await s2.wait_for_timeout(900)
        check('light gradient gets dark text automatically', await s2.evaluate("document.documentElement.dataset.theme==='light' && document.documentElement.dataset.bg==='gradient'"))
        await s2.screenshot(path=SP+'e2e_dark_gradient.png')
        # sidebar: sign-out visible even with notices on a short window
        await adm.set_viewport_size({'width':1280,'height':520}); await adm.wait_for_timeout(200)
        so = await adm.locator('.side-bottom button:has-text("Sign out")').bounding_box()
        check('sign-out stays on screen at 520px tall', so and so['y']+so['height'] <= 520)
        ov = await adm.evaluate("(()=>{const s=document.querySelector('.side-scroll');return s.scrollHeight>s.clientHeight})()")
        check('nav area scrolls independently', ov)
        await adm.screenshot(path=SP+'e2e_short_sidebar.png')
        await adm.set_viewport_size({'width':1280,'height':860})
        # change password
        await adm.goto(B+'/admin/#/security'); await adm.wait_for_timeout(600)
        pw = adm.locator('form input[type=password]')
        await pw.nth(0).fill('Default-pass-58'); await pw.nth(1).fill('My-new-pass-2026'); await pw.nth(2).fill('My-new-pass-2026')
        await adm.click('button:has-text("Change password") >> nth=-1'); await adm.wait_for_timeout(900)
        check('default-password notice gone', not await adm.is_visible('.side-notices >> text=The default password is still in use.'))
        # sign out, then login page has no default credentials
        await adm.click('.side-bottom button:has-text("Sign out")'); await adm.wait_for_timeout(700)
        check('no default credentials after first login', not await adm.is_visible('text=First sign-in'))
        check('hints always shown', await adm.is_visible('text=Hint: role_context@length'))
        # recovery #code prompt, wrong code
        await adm.click('text=Forgot your password?'); await adm.wait_for_timeout(400)
        check('#code prompt shown', await adm.is_visible('text=Enter the verification code.'))
        await adm.fill('#code','nope'); await adm.click('button:has-text("Verify")'); await adm.wait_for_timeout(500)
        check('wrong code blocked with error', "isn't valid" in await adm.inner_text('.form-error'))
        await adm.fill('#code','RECOVERY-CODE-2'); await adm.click('button:has-text("Verify")'); await adm.wait_for_timeout(500)
        check('recovery code -> queue request step', await adm.is_visible('button:has-text("Queue recovery request")'))
        await adm.fill('#rr-id','admin_context'); await adm.click('button:has-text("Queue recovery request")'); await adm.wait_for_timeout(500)
        check('request queued message', await adm.is_visible('text=Recovery request queued'))
        await adm.screenshot(path=SP+'e2e_recovery.png')
        print('\n'.join(results)); print('errors:', errs)
        await b.close()
asyncio.run(main())
