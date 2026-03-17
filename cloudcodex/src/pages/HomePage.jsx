import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import StdLayout from '../page_layouts/Std_Layout';
import { fetchProjects, fetchPages } from '../util';

export default function HomePage() {
  const navigate = useNavigate();
  const [recentPages, setRecentPages] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadRecent = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchProjects();
      const projects = res.projects || [];
      const allPages = [];
      for (const project of projects.slice(0, 5)) {
        try {
          const pagesRes = await fetchPages(project.id);
          const flatten = (pages) => {
            for (const p of pages) {
              allPages.push({ ...p, project_name: project.name });
              if (p.children?.length) flatten(p.children);
            }
          };
          flatten(pagesRes.pages || []);
        } catch { /* skip */ }
      }
      allPages.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setRecentPages(allPages.slice(0, 8));
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  return (
    <StdLayout>
      <div className="home-page">
        <section className="home-hero">
          <h1>Welcome to Cloud Codex</h1>
          <p className="text-muted">Your collaborative document workspace. Use the search bar above or navigate with the sidebar.</p>
        </section>

        <section className="home-recent">
          <h2>Recent Pages</h2>
          {loading && <p className="text-muted">Loading...</p>}
          {!loading && recentPages.length === 0 && (
            <p className="text-muted">No pages yet. Head to Projects to create your first document.</p>
          )}
          {!loading && recentPages.length > 0 && (
            <div className="card-grid">
              {recentPages.map(page => (
                <div key={page.id} className="card card--action" onClick={() => navigate(`/editor/${page.id}`)}>
                  <div className="card__body">
                    <h3 className="card__title">{page.title}</h3>
                    <p className="card__meta">{page.project_name}</p>
                    {page.created_at && (
                      <p className="card__meta">{new Date(page.created_at).toLocaleDateString()}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </StdLayout>
  );
}