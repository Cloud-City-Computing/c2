/**
 * Cloud Codex - Login Component
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import { destroyModal } from '../util';

/**
 * Renders a simple login modal.
 * @returns { JSX.Element } - The Login component
 */
export default function Login() {
  return (
    <div className="login-modal-content">
      <span className="close-button" onClick={ () => destroyModal() }>&times;</span>
      <h2>Login</h2>
      <p>Login process is not yet implemented.</p>
    </div>
  );
}