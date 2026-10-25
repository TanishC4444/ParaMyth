const $ = (id) => document.getElementById(id);
function accountMode(signup) {
  $('account-message').textContent = '';
  const url = new URL(location.href);
  if (signup) url.searchParams.set('mode', 'signup'); else url.searchParams.delete('mode');
  history.replaceState(null, '', url);
  $('show-login').setAttribute('aria-pressed', String(!signup));
  $('show-signup').setAttribute('aria-pressed', String(signup));
  $('account-heading').textContent = signup ? 'Create your account.' : 'Welcome back.';
  $('account-intro').textContent = signup ? 'Start a studio and bring your stories together.' : 'Sign in to your team’s shared stories.';
  $('display-name-field').hidden = !signup;
  $('display-name').required = signup;
  $('password').autocomplete = signup ? 'new-password' : 'current-password';
  $('account-submit').value = signup ? 'signup' : 'login';
  $('account-submit').textContent = signup ? 'Create account →' : 'Sign in →';
  $('signup-prompt').hidden = signup;
}
$('show-login').addEventListener('click', () => accountMode(false));
$('show-signup').addEventListener('click', () => accountMode(true));
$('signup-link').addEventListener('click', () => accountMode(true));
if (new URLSearchParams(location.search).get('mode') === 'signup') accountMode(true);
let token = '', base = '', user = null, studios = [], active = null, project = null, dirty = false, busy = false, redirecting = false;
const pendingInvite = new URLSearchParams(location.hash.slice(1)).get('invite');
if (pendingInvite) {
  location.replace('/#/join?invite=' + encodeURIComponent(pendingInvite));
}
const configuredApi = document.querySelector('meta[name="paramyth-api"]')?.content || '';
const defaultApi = configuredApi || (location.pathname.startsWith('/studio/') ? location.origin : 'http://localhost:8000');
try { $('team-api').value = location.pathname.startsWith('/studio/') ? defaultApi : localStorage.getItem('sf.api') || defaultApi; }
catch { $('team-api').value = defaultApi; }
// The bundled local UI already knows its server; only standalone hosting needs this setting.
if (location.pathname.startsWith('/studio/')) $('team-api').closest('label').hidden = true;

function message(text, error = false) {
  $('message').textContent = text;
  $('message').className = error ? 'error' : '';
}
function apiBase(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Use an HTTPS API URL, or HTTP on localhost.');
  }
  return url.href.replace(/\/$/, '').replace(/\/api\/v1$/, '');
}
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method, headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
    body: body === undefined ? undefined : JSON.stringify(body), credentials: 'include', cache: 'no-store',
    signal: AbortSignal.timeout(30000),
  });
  const value = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const detail = value?.detail;
    const error = new Error(Array.isArray(detail) ? detail.map((x) => `${x.loc.at(-1)}: ${x.msg}`).join('; ') : detail || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return value;
}
function lockUI() {
  const controls = [...document.querySelectorAll('button,input,select,textarea')].map((node) => [node, node.disabled]);
  controls.forEach(([node]) => { node.disabled = true; });
  return () => controls.forEach(([node, disabled]) => { node.disabled = disabled; });
}
function on(id, event, action) {
  $(id).addEventListener(event, async (ev) => {
    ev.preventDefault();
    if (busy) return;
    busy = true;
    const unlock = lockUI();
    try { await action(ev); }
    catch (err) { if (id === 'account-form') $('account-message').textContent = err.message; else message(err.message, true); }
    finally { busy = false; unlock(); applyPermissions(); }
  });
}
function button(label, action) {
  const node = document.createElement('button'); node.type = 'button'; node.textContent = label;
  node.addEventListener('click', async () => {
    if (busy) return;
    busy = true; const unlock = lockUI();
    try { await action(); } catch (err) { message(err.message, true); }
    finally { busy = false; unlock(); applyPermissions(); }
  });
  return node;
}
function line(text, ...controls) {
  const li = document.createElement('li'), span = document.createElement('span');
  span.textContent = text; li.append(span, ...controls); return li;
}
function option(value, text) { const node = document.createElement('option'); node.value = value; node.textContent = text; return node; }
function discardDraft() { return !dirty || window.confirm('Discard your unsaved edits? Download your draft first if you want to keep it.'); }
function path(suffix = '') { return `/studios/${active.id}${suffix}`; }
function projectPath(suffix = '') { return path(`/projects/${project.id}${suffix}`); }
function applyPermissions() {
  const edit = active && ['owner', 'admin', 'editor'].includes(active.role);
  const manage = active && ['owner', 'admin'].includes(active.role);
  $('team-settings').hidden = !manage;
  $('invite-role').querySelector('option[value="admin"]').disabled = active?.role !== 'owner';
  if (active?.role !== 'owner' && $('invite-role').value === 'admin') $('invite-role').value = 'editor';
  $('new-project').hidden = !edit; $('save-project').hidden = !edit; $('comment-form').hidden = !edit;
  for (const id of ['project-title', 'project-brief', 'project-manuscript']) $(id).readOnly = !edit;
}
function signedOut() {
  token = ''; user = null; active = null; project = null; dirty = false;
  $('workspace').hidden = true; $('account').hidden = false; $('logout').hidden = true;
  $('password').value = ''; $('current-password').value = ''; $('new-password').value = '';
  $('invite-link').value = ''; $('invite-result').hidden = true;
  for (const id of ['project-title', 'project-brief', 'project-manuscript', 'revision-preview']) $(id).value = '';
  for (const id of ['members', 'comments', 'invitations', 'revisions', 'revision-preview']) $(id).replaceChildren();
}
async function loadStudios(preferred = active?.id) {
  const memberships = await api('/studios');
  studios = memberships.filter(studio => ['owner', 'admin'].includes(studio.role));
  if (!studios.length && memberships.length) {
    redirecting = true;
    location.replace('/#/projects?studio=' + encodeURIComponent(memberships[0].id));
    return;
  }
  $('studio-select').replaceChildren(...studios.map((s) => option(s.id, s.name)));
  active = studios.find((s) => s.id === preferred) || studios[0] || null;
  $('studio-content').hidden = !active;
  if (active) { $('studio-select').value = active.id; await loadStudio(); }
  else message('Create your first studio or join with an invitation.');
}
async function loadStudio() {
  project = null; dirty = false;
  $('project-form').hidden = true; $('project-discussion').hidden = true; $('invite-result').hidden = true;
  $('my-role').textContent = `· ${active.role}`; $('rename-name').value = active.name;
  applyPermissions();
  $('team-workspace-link').href = '/#/projects?studio=' + encodeURIComponent(active.id);
  await loadMembers();
  if (['owner', 'admin'].includes(active.role)) await loadInvitations();
}
async function loadMembers() {
  const members = await api(path('/members'));
  $('members').replaceChildren(...members.map((m) => {
    const controls = [];
    if (active.role === 'owner' && m.role !== 'owner') {
      const select = document.createElement('select'); select.setAttribute('aria-label', `Role for ${m.display_name}`);
      select.append(...['admin', 'editor', 'viewer'].map((r) => option(r, r))); select.value = m.role;
      controls.push(select, button('Save role', async () => {
        await api(path(`/members/${m.id}`), 'PATCH', {role: select.value}); await loadMembers(); message('Role updated.');
      }), button('Remove', async () => {
        if (!window.confirm(`Remove ${m.display_name} from this studio?`)) return;
        await api(path(`/members/${m.id}`), 'DELETE'); await loadMembers(); message('Member removed.');
      }));
    }
    return line(`${m.display_name} · ${m.email} · ${m.role}`, ...controls);
  }));
}
async function loadInvitations() {
  const invitations = await api(path('/invitations'));
  $('invitations').replaceChildren(...invitations.map((i) => line(`${i.email} · ${i.role} · expires ${new Date(i.expires_at).toLocaleDateString()}`,
    ...((i.role !== 'admin' || active.role === 'owner') ? [button('Revoke', async () => {
      await api(path(`/invitations/${i.id}`), 'DELETE'); await loadInvitations(); message('Invitation revoked.');
    })] : []))));
}
async function loadProjects() {
  const projects = await api(path('/projects'));
  $('project-select').replaceChildren(option('', 'Choose a project'), ...projects.map((p) => option(p.id, `${p.title} · v${p.version}`)));
  if (project?.id) $('project-select').value = project.id;
}
async function openProject(id) {
  const value = await api(path(`/projects/${id}`));
  project = value; dirty = false;
  $('project-form').hidden = false; $('project-discussion').hidden = false;
  $('project-title').value = value.title; $('project-brief').value = value.brief; $('project-manuscript').value = value.manuscript;
  $('version').textContent = `Version ${value.version} · saved ${new Date(value.updated_at).toLocaleString()}`;
  $('reload-project').hidden = false; $('revision-preview').hidden = true;
  await loadDiscussion(); applyPermissions();
}
async function loadDiscussion() {
  const [comments, revisions] = await Promise.all([api(projectPath('/comments')), api(projectPath('/revisions'))]);
  $('comments').replaceChildren(...comments.map((c) => line(`${c.display_name} · ${new Date(c.created_at).toLocaleString()}\n${c.body}`)));
  $('revisions').replaceChildren(...revisions.map((r) => line(`Version ${r.version} · ${r.display_name} · ${new Date(r.created_at).toLocaleString()}`,
    button('Read', async () => {
      const revision = await api(projectPath(`/revisions/${r.version}`));
      $('revision-preview').textContent = `${revision.title}\n\n${revision.brief}\n\n${revision.manuscript}`;
      $('revision-preview').hidden = false;
    }))));
}
on('account-form', 'submit', async (ev) => {
  base = apiBase($('team-api').value.trim());
  const mode = ev.submitter?.value || $('account-submit').value;
  const body = {email: $('email').value.trim(), password: $('password').value};
  if (mode === 'signup') body.display_name = $('display-name').value.trim();
  $('account-message').textContent = '';
  let result;
  try { result = await api(`/accounts/${mode}`, 'POST', body); }
  catch (error) {
    if (mode === 'signup' && error.status === 409) {
      accountMode(false);
      $('account-message').textContent = 'This account could not be created. If you already have an account, sign in below with your existing password.';
      return;
    }
    throw error;
  }
  token = result.token; user = result.user; $('password').value = '';
  try { localStorage.setItem('paramyth-account-change', String(Date.now())); } catch {}
  try { localStorage.setItem('sf.api', base); } catch { /* storage is optional */ }
  $('account').hidden = true; $('logout').hidden = false;
  $('welcome').textContent = `${user.display_name}'s studios`;
  await loadStudios(); $('workspace').hidden = redirecting; message('Signed in.');
});
on('logout', 'click', async () => {
  if (!discardDraft()) return;
  try { await api('/accounts/logout', 'POST'); }
  finally { signedOut(); }
  try { localStorage.setItem('paramyth-account-change', String(Date.now())); } catch {}
  message('Signed out.');
});
// Restore the HttpOnly session after refresh; no bearer token goes into browser storage.
(async () => {
  if (!location.pathname.startsWith('/studio/') || pendingInvite) return;
  base = defaultApi;
  try {
    user = await api('/accounts/me');
    $('account').hidden = true; $('logout').hidden = false;
    $('welcome').textContent = `${user.display_name}'s studios`;
    await loadStudios(); $('workspace').hidden = redirecting;
  } catch { signedOut(); }
})();

on('create-studio', 'submit', async () => {
  if (!discardDraft()) return;
  const studio = await api('/studios', 'POST', {name: $('studio-name').value.trim()});
  $('studio-name').value = ''; await loadStudios(studio.id); message('Studio created. Invite your team below.');
});
on('join-studio', 'submit', async () => {
  if (!discardDraft()) return;
  const studio = await api('/invitations/accept', 'POST', {token: $('invitation-token').value.trim()});
  $('invitation-token').value = ''; location.assign('/#/projects?studio=' + encodeURIComponent(studio.id));
});
on('studio-select', 'change', async () => {
  if (!discardDraft()) { $('studio-select').value = active.id; return; }
  active = studios.find((s) => s.id === $('studio-select').value); await loadStudio(); message('Studio loaded.');
});
on('refresh', 'click', async () => { if (discardDraft()) { await loadStudios(); message('Team refreshed.'); } });
on('rename-studio', 'submit', async () => {
  const result = await api(path(), 'PATCH', {name: $('rename-name').value.trim()});
  active.name = result.name;
  $('studio-select').selectedOptions[0].textContent = result.name; message('Studio renamed.');
});
on('invite-form', 'submit', async () => {
  const result = await api(path('/invitations'), 'POST', {email: $('invite-email').value.trim(), role: $('invite-role').value});
  const url = new URL('/#/join?invite=' + encodeURIComponent(result.token), location.origin);
  $('invite-link').value = url.href; $('invite-result').hidden = false; await loadInvitations();
  message('Invitation created. Copy the link and share it privately with the invited person.');
});
on('new-project', 'click', async () => {
  if (!discardDraft()) return;
  project = null; dirty = false; $('project-select').value = ''; $('project-form').hidden = false;
  $('project-discussion').hidden = true; $('reload-project').hidden = true;
  for (const id of ['project-title', 'project-brief', 'project-manuscript']) $(id).value = '';
  $('version').textContent = 'New project · not saved yet'; $('project-title').focus();
});
on('project-select', 'change', async () => {
  if (!discardDraft()) { $('project-select').value = project?.id || ''; return; }
  if ($('project-select').value) await openProject($('project-select').value);
  else { project = null; dirty = false; $('project-form').hidden = true; $('project-discussion').hidden = true; }
});
on('project-form', 'submit', async () => {
  const body = {title: $('project-title').value.trim(), brief: $('project-brief').value, manuscript: $('project-manuscript').value};
  if (project) body.version = project.version;
  const result = await api(project ? projectPath() : path('/projects'), project ? 'PUT' : 'POST', body);
  await openProject(result.id); await loadProjects(); message('Project saved for your team.');
});
on('reload-project', 'click', async () => { if (project && discardDraft()) { await openProject(project.id); message('Latest version loaded.'); } });
on('download-draft', 'click', async () => {
  const blob = new Blob([$('project-title').value, '\n\n', $('project-brief').value, '\n\n', $('project-manuscript').value], {type: 'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'story-draft.txt'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
on('comment-form', 'submit', async () => {
  await api(projectPath('/comments'), 'POST', {body: $('comment-body').value}); $('comment-body').value = '';
  await loadDiscussion(); message('Comment posted.');
});
on('password-form', 'submit', async () => {
  if (!discardDraft()) return;
  await api('/accounts/password', 'POST', {current_password: $('current-password').value, new_password: $('new-password').value});
  signedOut(); message('Password changed. Sign in with your new password.');
});
for (const id of ['project-title', 'project-brief', 'project-manuscript']) $(id).addEventListener('input', () => { dirty = true; });
window.addEventListener('beforeunload', (ev) => { if (dirty) { ev.preventDefault(); ev.returnValue = ''; } });
