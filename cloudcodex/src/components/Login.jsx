import { createRoot } from 'react-dom/client';
import { clearInner, createAndAppend, destroyModal } from '../util';

export default function Login() {
  return (
    <div className="login-modal-content">
      <span className="close-button" onClick={ () => destroyModal() }>&times;</span>
      <h2>Login</h2>
      <p>Login process is not yet implemented.</p>
    </div>
  );
}