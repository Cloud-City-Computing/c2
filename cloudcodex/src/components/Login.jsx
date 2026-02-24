/**
 * Cloud Codex - Login Component
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import { destroyModal, showModal, getSessionTokenFromCookie, serverReq } from '../util';

/**
 * Performs a login attempt by sending the username and password to the server.
 * On successful login, it stores the session token in a cookie and reloads the page.
 * On failure, it displays an error message.
 * @returns { void }
 */
async function doLoginAttempt() {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const response = await serverReq( 'POST', '/api/login', { 
    username, 
    password
  } );
  if ( response.success ) {
    const existingToken = getSessionTokenFromCookie(); // Check to see if the user has an existing cookie
    if ( existingToken && existingToken != "" && existingToken === response.token ) {
      window.location.reload(); // Reload the page to reflect logged-in state
    }
    document.cookie = `sessionToken=${response.token}; path=/; max-age=${7 * 24 * 60 * 60}; secure; samesite=strict`;
    window.location.reload();
  }
  else {
    alert('Login failed: ' + response.message);
  }
}

/**
 * Performs a login attempt by sending the username and password to the server.
 * On successful login, it stores the session token in a cookie and reloads the page.
 * On failure, it displays an error message.
 * @returns { void }
 */
async function createC2Account() {
  try {
    const response = await serverReq( 'POST', '/api/create-account', {
      username: document.getElementById('new-username').value,
      password: document.getElementById('new-password').value,
      email: document.getElementById('new-email').value
    } );
    if ( response.success ) {
      document.cookie = `sessionToken=${response.token}; path=/; max-age=${7 * 24 * 60 * 60}; secure; samesite=strict`;
      window.location.reload();
    }
    else {
      alert('Error creating account: ' + response.message);
    }
  }
  catch (error) {
    console.error('Error creating account:', error);
    alert('An error occurred while creating the account. Please try again.');
  }
}

/**
 * Creates a JSX element for the account creation form, which includes 
 * fields for username, email, and password.
 * @returns { JSX.Element } - The account creation form JSX
 */
function createAccountForm() {
  return (
    <div className="modal-content">
      <span className="close-button" onClick={ () => destroyModal() }>&times;</span>
      <h2>Create Account</h2>
      <div className="login-form">
        <label htmlFor="new-username">Username:</label>
        <div className="input-group">
          <input type="text" id="new-username" name="new-username" required />
        </div>
        <label htmlFor="new-email">Email:</label>
        <div className="input-group">
          <input type="email" id="new-email" name="new-email" required />
        </div>
        <label htmlFor="new-password">Password:</label>
        <div className="input-group">
          <input type="password" id="new-password" name="new-password" required />
        </div>
        <button type="button" className="c2-btn stretched-button" onClick={ () => createC2Account() }>Create Account</button>
      </div>
    </div>
  );
}

/**
 * Displays a standard login form with username and password fields.
 * @returns { JSX.Element } - The login form JSX element
 */
function standardLoginForm() {
  return (
    <div className="login-form">
      <label htmlFor="username">Username:</label>
      <div className="input-group">
        <input type="text" id="username" name="username" />
      </div>
      <label htmlFor="password">Password:</label>
      <div className="input-group">
        <input type="password" id="password" name="password" />
      </div>
      <button className="c2-btn stretched-button" onClick={ () => doLoginAttempt() }>Login</button>
      <button className="c2-btn stretched-button" onClick={ () => createAccount() }>Create Account</button>
    </div>
  );
}

/**
 * Displays a create account form with username, email, and password fields.
 * @returns { void }
 */
function createAccount() {
  destroyModal();
  showModal( createAccountForm(), "modal-md" );
}

/**
 * Renders a simple login modal.
 * @returns { JSX.Element } - The Login component
 */
export default function Login() {
  return (
    <div className="modal-content">
      <span className="close-button" onClick={ () => destroyModal() }>&times;</span>
      <h2>Login</h2>
      { standardLoginForm() }
    </div>
  );
}