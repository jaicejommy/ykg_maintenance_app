/**
 * frontend/js/auth.js
 * Token storage, session management, login/logout, and auth-guard redirect.
 * Each function has a single responsibility.
 */

/**
 * Persist the auth token, role, and username to sessionStorage.
 * @param {string} token
 * @param {string} role
 * @param {string} username
 */
function saveToken(token, role, username) {
  sessionStorage.setItem(SESSION_KEYS.TOKEN,    token);
  sessionStorage.setItem(SESSION_KEYS.ROLE,     role);
  sessionStorage.setItem(SESSION_KEYS.USERNAME, username);
}

/**
 * Retrieve the stored JWT. Returns null if not present.
 * @returns {string|null}
 */
function getToken() {
  return sessionStorage.getItem(SESSION_KEYS.TOKEN);
}

/**
 * Retrieve the stored user role.
 * @returns {string|null}
 */
function getRole() {
  return sessionStorage.getItem(SESSION_KEYS.ROLE);
}

/**
 * Retrieve the stored username.
 * @returns {string|null}
 */
function getUsername() {
  return sessionStorage.getItem(SESSION_KEYS.USERNAME);
}

/**
 * Clear all session data from sessionStorage.
 */
function clearSession() {
  sessionStorage.removeItem(SESSION_KEYS.TOKEN);
  sessionStorage.removeItem(SESSION_KEYS.ROLE);
  sessionStorage.removeItem(SESSION_KEYS.USERNAME);
}

/**
 * Auth guard — call at the top of every protected page.
 * Redirects to index.html immediately if no token is found.
 */
function guardPage() {
  if (!getToken()) {
    window.location.replace("index.html");
  }
}

/**
 * Log the current user out: clear session then redirect to login.
 */
function logout() {
  clearSession();
  window.location.replace("index.html");
}
