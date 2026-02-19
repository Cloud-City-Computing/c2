import StdLayout from '../page_layouts/Std_Layout';
import { standardRedirect } from '../util';

function AccountSettings() {
  return (
    <StdLayout>
      <h1>Account Settings</h1>
      <p>This page is under construction. Please check back later.</p>
      <button className="c2-btn" onClick={ () => standardRedirect('/') }>Return to Home</button>
    </StdLayout>
  );
}

export default AccountSettings;