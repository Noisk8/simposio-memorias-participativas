// @ts-nocheck
import { getAdminToken, waitForAdminAuth } from './client.ts';
const notAllowed = document.getElementById('not-allowed');
const loading = document.getElementById('loading');
const adminPanel = document.getElementById('admin-panel');
const usersLoading = document.getElementById('users-loading');
const usersError = document.getElementById('users-error');
const usersTable = document.getElementById('users-table');
const usersBody = document.getElementById('users-body');
const usersEmpty = document.getElementById('users-empty');
const usersSummary = document.getElementById('users-summary');
const actionStatus = document.getElementById('action-status');
const refreshBtn = document.getElementById('refresh-btn');
const userSearch = document.getElementById('user-search');
const createForm = document.getElementById('create-user-form');
const createUserError = document.getElementById('create-user-error');
const inviteCredentials = document.getElementById('invite-credentials');
const createUserBtn = document.getElementById('create-user-btn');
const createUserName = document.getElementById('create-user-name');
const createUserEmail = document.getElementById('create-user-email');
const createUserRole = document.getElementById('create-user-role');
const createUserPassword = document.getElementById('create-user-password');
let allUsers = [];

const roles = ['superadmin', 'admin', 'editor', 'reviewer', 'author', 'read_only'];
const roleLabels = {
  superadmin: 'Superadministración',
  admin: 'Administración',
  editor: 'Edición',
  reviewer: 'Revisión',
  author: 'Autoría',
  read_only: 'Solo lectura',
};

function waitForAuth(callback) {
  return waitForAdminAuth()
    .then(callback)
    .catch((error) => {
      loading.textContent = error.message;
    });
}

async function getToken() {
  return getAdminToken().catch(() => null);
}

function setActionStatus(message, kind = '') {
  actionStatus.textContent = message;
  actionStatus.dataset.kind = kind;
}

function clearCreateFeedback() {
  createUserError?.classList.add('hidden');
  if (inviteCredentials) {
    inviteCredentials.classList.add('hidden');
    inviteCredentials.textContent = '';
  }
}

function showCreateError(message) {
  if (!createUserError) return;
  createUserError.textContent = message;
  createUserError.classList.remove('hidden');
}

function renderInviteSummary(user, invite) {
  if (!inviteCredentials) return;

  inviteCredentials.classList.remove('hidden');
  inviteCredentials.innerHTML = '';
  const currentRole = Array.isArray(user.roles) ? user.roles[0] : '';

  const title = document.createElement('strong');
  title.textContent = 'Cuenta creada correctamente';

  const summary = document.createElement('p');
  summary.textContent = user.email + ' · ' + (roleLabels[currentRole] || currentRole || 'Sin rol');

  const passwordLabel = document.createElement('span');
  passwordLabel.textContent = 'Contraseña temporal';

  const passwordValue = document.createElement('code');
  passwordValue.textContent = invite.password || '';

  const status = document.createElement('p');
  status.textContent = invite.emailSent
    ? 'El correo de acceso fue enviado.'
    : 'El correo no pudo enviarse automáticamente.';

  const reason = document.createElement('small');
  if (!invite.emailSent && invite.emailReason) {
    reason.textContent = 'Detalle: ' + invite.emailReason;
  } else {
    reason.textContent = 'Guarda la contraseña temporal si necesitas reenviarla manualmente.';
  }

  inviteCredentials.append(title, summary, passwordLabel, passwordValue, status, reason);
}

async function loadUsers() {
  usersLoading.classList.remove('hidden');
  usersError.classList.add('hidden');
  usersTable.classList.add('hidden');
  usersEmpty.classList.add('hidden');
  refreshBtn.disabled = true;

  const token = await getToken();
  if (!token) {
    showLoadError('No se encontró el token de sesión.');
    return;
  }

  try {
    const response = await fetch('/.netlify/functions/manage-users', {
      headers: { Authorization: 'Bearer ' + token },
    });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      showLoadError(
        'Las funciones administrativas no están disponibles. Abre esta página con netlify dev o desde producción.'
      );
      return;
    }

    const data = await response.json();
    if (!response.ok) {
      showLoadError(data.error?.message || 'Error al cargar los usuarios.');
      return;
    }

    allUsers = data.users || [];
    updateStats(allUsers);
    renderFilteredUsers();
    usersLoading.classList.add('hidden');
    refreshBtn.disabled = false;
  } catch (error) {
    showLoadError('Error de red: ' + error.message);
  }
}

function showLoadError(message) {
  usersLoading.classList.add('hidden');
  usersError.textContent = message;
  usersError.classList.remove('hidden');
  refreshBtn.disabled = false;
}

function updateStats(users) {
  const hasRole = (user, expected) => user.roles.some((role) => expected.includes(role));
  document.getElementById('stat-total').textContent = users.length;
  document.getElementById('stat-managers').textContent = users.filter((user) =>
    hasRole(user, ['superadmin', 'admin'])
  ).length;
  document.getElementById('stat-editorial').textContent = users.filter((user) =>
    hasRole(user, ['editor', 'reviewer', 'author'])
  ).length;
  document.getElementById('stat-inactive').textContent = users.filter(
    (user) => user.disabled || !user.roles.length
  ).length;
}

function renderFilteredUsers() {
  const query = userSearch.value.trim().toLocaleLowerCase('es');
  const visible = allUsers.filter((user) =>
    [user.name, user.email, ...(user.roles || [])].join(' ').toLocaleLowerCase('es').includes(query)
  );
  renderUsers(visible);
  usersSummary.textContent =
    visible.length === allUsers.length
      ? allUsers.length + (allUsers.length === 1 ? ' usuario cargado.' : ' usuarios cargados.')
      : visible.length + ' de ' + allUsers.length + ' usuarios.';
}

function renderUsers(users) {
  usersBody.innerHTML = '';
  usersTable.classList.toggle('hidden', users.length === 0);
  usersEmpty.classList.toggle('hidden', users.length !== 0);

  users.forEach(function (user) {
    const row = document.createElement('tr');
    const currentRole = user.roles[0] || '';

    const userCell = document.createElement('td');
    const identity = document.createElement('div');
    identity.className = 'cms-user-identity';
    const avatar = document.createElement('span');
    avatar.className = 'cms-user-avatar';
    const initial = String(user.name || user.email || '?')
      .slice(0, 1)
      .toUpperCase();
    avatar.setAttribute('data-initial', initial);
    avatar.textContent = initial;
    const userText = document.createElement('div');
    const userName = document.createElement('strong');
    userName.textContent = user.name || user.email;
    const userEmail = document.createElement('span');
    userEmail.textContent = user.email;
    userText.append(userName, userEmail);
    identity.append(avatar, userText);
    userCell.appendChild(identity);

    const statusCell = document.createElement('td');
    const statusBadge = document.createElement('span');
    statusBadge.className = 'cms-user-status';
    statusBadge.dataset.disabled = String(Boolean(user.disabled));
    statusBadge.textContent = user.disabled ? 'Deshabilitado' : 'Activo';
    statusCell.appendChild(statusBadge);

    const roleCell = document.createElement('td');
    const roleBadge = document.createElement('span');
    roleBadge.className = 'cms-role-badge';
    roleBadge.dataset.role = currentRole || 'none';
    roleBadge.textContent = roleLabels[currentRole] || 'Sin rol';
    roleCell.appendChild(roleBadge);

    const actionsCell = document.createElement('td');
    const form = document.createElement('div');
    form.className = 'cms-role-control';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Nuevo rol para ' + user.email);
    roles.forEach(function (role) {
      const option = document.createElement('option');
      option.value = role;
      option.textContent = roleLabels[role];
      option.selected = role === (currentRole || 'author');
      select.appendChild(option);
    });
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Guardar';
    button.disabled = select.value === currentRole;
    select.addEventListener('change', function () {
      button.disabled = select.value === currentRole;
    });
    button.addEventListener('click', function () {
      setRoles(user, [select.value], button);
    });
    form.append(select, button);
    actionsCell.appendChild(form);

    row.append(userCell, statusCell, roleCell, actionsCell);
    usersBody.appendChild(row);
  });
}

async function setRoles(user, selectedRoles, button) {
  setActionStatus('Actualizando el rol de ' + user.email + '…');
  button.disabled = true;
  const token = await getToken();
  if (!token) {
    setActionStatus('No se encontró el token de sesión.', 'error');
    button.disabled = false;
    return;
  }

  try {
    const response = await fetch('/.netlify/functions/manage-users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({ userId: user.id, roles: selectedRoles }),
    });
    const data = await response.json();
    if (!response.ok) {
      setActionStatus(data.error?.message || 'Error al actualizar el rol.', 'error');
      button.disabled = false;
      return;
    }
    setActionStatus('Rol actualizado correctamente para ' + user.email + '.', 'success');
    await loadUsers();
  } catch (error) {
    setActionStatus('Error de red: ' + error.message, 'error');
    button.disabled = false;
  }
}

async function createUser(event) {
  event.preventDefault();
  clearCreateFeedback();
  setActionStatus('');

  if (!createUserBtn) return;

  createUserBtn.disabled = true;

  const name = String(createUserName?.value || '').trim();
  const email = String(createUserEmail?.value || '').trim();
  const role = String(createUserRole?.value || 'author');
  const password = String(createUserPassword?.value || '').trim();

  if (!name || !email) {
    showCreateError('Completa el nombre y el correo antes de crear la cuenta.');
    createUserBtn.disabled = false;
    return;
  }

  const token = await getToken();
  if (!token) {
    showCreateError('No se encontró el token de sesión.');
    createUserBtn.disabled = false;
    return;
  }

  try {
    const response = await fetch('/.netlify/functions/manage-users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({
        action: 'create',
        name,
        email,
        role,
        ...(password ? { password } : {}),
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      showCreateError(data.error?.message || 'No se pudo crear el usuario.');
      createUserBtn.disabled = false;
      return;
    }

    const createdUser = data.user || { email, roles: [role] };
    const invite = data.invite || {};
    setActionStatus(
      invite.emailSent
        ? 'Usuario creado y correo enviado a ' + createdUser.email + '.'
        : 'Usuario creado, pero el correo no se pudo enviar automáticamente.',
      invite.emailSent ? 'success' : 'warning'
    );
    renderInviteSummary(createdUser, invite);
    createForm?.reset();
    if (createUserRole) createUserRole.value = 'author';
    await loadUsers();
  } catch (error) {
    showCreateError('Error de red: ' + error.message);
  } finally {
    createUserBtn.disabled = false;
  }
}

waitForAuth(function (auth) {
  function refresh() {
    auth.getUser().then(function (user) {
      loading.classList.add('hidden');
      if (!user) {
        adminPanel.classList.add('hidden');
        return;
      }
      notAllowed.classList.add('hidden');
      adminPanel.classList.remove('hidden');
      loadUsers();
    });
  }
  auth.ready.then(refresh);
  window.addEventListener('supabase-auth', refresh);
});

refreshBtn?.addEventListener('click', loadUsers);
userSearch?.addEventListener('input', renderFilteredUsers);
createForm?.addEventListener('submit', createUser);
