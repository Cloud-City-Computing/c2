/**
 * Cloud Codex - Login Component
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import { destroyModal } from '../util';

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
      <button className="c2-btn stretched-button">Login</button>

    </div>
  );
}

/**
 * Renders a simple login modal.
 * @returns { JSX.Element } - The Login component
 */
export default function Login() {
  return (
    <div className="login-modal-content">
      <span className="close-button" onClick={ () => destroyModal() }>&times;</span>
      <h2>Login</h2>
      { standardLoginForm() }
    </div>
  );
}