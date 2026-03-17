import { useNavigate } from 'react-router-dom';
import StdLayout from '../page_layouts/Std_Layout';

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <StdLayout>
      <div className="home-page">
        <section className="home-hero">
          <h1>Welcome to Cloud Codex</h1>
          <p className="text-muted">Your collaborative document workspace. Search from the top bar, or jump to a section below.</p>
        </section>

        <div className="card-grid home-quicklinks">
          <div className="card card--action" onClick={() => navigate('/projects')}>
            <div className="card__body">
              <h3 className="card__title">Projects</h3>
              <p className="card__meta">Browse and manage your projects and pages.</p>
            </div>
          </div>
          <div className="card card--action" onClick={() => navigate('/organizations')}>
            <div className="card__body">
              <h3 className="card__title">Organizations</h3>
              <p className="card__meta">Manage organizations and teams.</p>
            </div>
          </div>
          <div className="card card--action" onClick={() => navigate('/account')}>
            <div className="card__body">
              <h3 className="card__title">Account</h3>
              <p className="card__meta">Update your profile and preferences.</p>
            </div>
          </div>
        </div>
      </div>
    </StdLayout>
  );
}