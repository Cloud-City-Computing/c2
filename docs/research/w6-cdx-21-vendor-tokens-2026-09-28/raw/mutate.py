import subprocess, re, sys
import os
W=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..', 'cloudcodex')
def run():
    r=subprocess.run(['npx','vitest','run','--project','design'],cwd=W,capture_output=True,text=True)
    out=re.sub(r'\x1b\[[0-9;]*m','',r.stdout+r.stderr)
    fails=sorted(set(l.strip() for l in out.splitlines() if l.strip().startswith('FAIL') and ' > ' in l))
    return r.returncode, fails
def restore(f): subprocess.run(['git','checkout','--',f],cwd=W,check=True)
def clean():
    return subprocess.run(['git','status','--porcelain'],cwd=W,capture_output=True,text=True).stdout.strip()==''
muts=[
 ('raw hex in a .jsx','src/components/Toast.jsx', lambda s: s.replace("import { createRoot } from 'react-dom/client';\n", "import { createRoot } from 'react-dom/client';\nconst SEEDED = { color: '#ff0000' };\n",1), "client';\nconst SEEDED = { color: '#ff0000' };"),
 ('outline: none in index.css','src/index.css', lambda s: s.replace(".btn-oauth:hover {", ".btn-oauth:hover {\n  outline: none;",1), "outline: none;\n  background: var(--bg-hover);"),
 ('fill alias in a text position','src/index.css', lambda s: s.replace(".btn-oauth:hover {", ".btn-oauth:hover {\n  color: var(--cx-accent-fill);",1), "color: var(--cx-accent-fill);"),
 ('dangling var(--nope)','src/index.css', lambda s: s.replace(".btn-oauth:hover {", ".btn-oauth:hover {\n  color: var(--nope);",1), "var(--nope)"),
 ('one byte of vendored core.css','vendor/cloud-city-design/core.css', lambda s: s.replace("--brand-blue: #2ca7db;","--brand-blue: #2ca7dc;",1), "#2ca7dc"),
 ('a pair below its minimum','src/codex.css', lambda s: s.replace("--cx-text-faint: oklch(0.77 0.005 240);","--cx-text-faint: oklch(0.70 0.005 240);",1), "oklch(0.70 0.005 240)"),
 ('a colour binding with no pair','src/codex.css', lambda s: s.replace("  --cx-focus-ring: var(--cx-accent);","  --cx-focus-ring: var(--cx-accent);\n  --cx-extra: oklch(0.5 0.1 100);",1), "--cx-extra"),
 ('a non --cx- name in codex.css','src/codex.css', lambda s: s.replace("  --cx-border:","  --border-x: oklch(0.4 0 0);\n  --cx-border:",1), "--border-x"),
 ('data-theme dropped','index.html', lambda s: s.replace(' data-theme="dark"','',1), None),
 ('legal comments stripped','vite.config.js', lambda s: s.replace("esbuild: { legalComments: 'inline' },","",1), None),
 ('import order swapped','src/main.jsx', lambda s: s.replace("import './codex.css'\nimport './index.css'","import './index.css'\nimport './codex.css'",1), "import './index.css'\nimport './codex.css'"),
 ('a fixed dangling reference reverted','src/index.css', lambda s: s.replace("background: var(--color-danger);\n  color: #fff;","background: var(--red);\n  color: #fff;",1), "var(--red)"),
 ('an unrecorded fix (one literal removed)','src/util.jsx', lambda s: re.sub(r"#[0-9a-fA-F]{6}\b", "inherit", s, count=1), None),
]
assert clean()
for name,f,fn,marker in muts:
    p=f'{W}/{f}'; s=open(p).read(); m=fn(s)
    assert m!=s, f'mutation did not change {f}: {name}'
    open(p,'w').write(m)
    landed = (marker is None) or (marker in open(p).read())
    code,fails=run()
    restore(f)
    print(f'[{name}] landed={landed} exit={code}')
    for x in fails: print('   red:', x)
    assert clean(), 'restore failed'
code,fails=run(); print('after restore exit', code, fails)
