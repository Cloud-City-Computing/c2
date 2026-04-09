-- Cloud Codex - Seed Data
--
-- Generates ~60 documents across multiple archives and users
-- for testing search, browse, pagination, and UI density.
--
-- All passwords resolve to "password"
--
-- All Rights Reserved to Cloud City Computing, LLC 2026
-- https://cloudcitycomputing.com

DELETE FROM versions;
DELETE FROM logs;
DELETE FROM archives;
DELETE FROM squad_members;
DELETE FROM squad_invitations;
DELETE FROM squad_permissions;
DELETE FROM permissions;
DELETE FROM squads;
DELETE FROM sessions;
DELETE FROM password_reset_tokens;
DELETE FROM two_factor_codes;
DELETE FROM oauth_accounts;
DELETE FROM users;
DELETE FROM workspaces;

-- =========================
-- Workspaces
-- =========================
INSERT INTO workspaces (name, owner) VALUES ('Acme Corporation', 'alice@acme.com');
SET @workspace_id = LAST_INSERT_ID();

-- =========================
-- Users (password = "password" for all)
-- =========================
INSERT INTO users (name, email, password_hash) VALUES
  ('alice',  'alice@acme.com',  '$2b$10$Sd3GKFmu8.CRz86c3jQI5u3f.Lju4H3Ez5SSjTJjRAqMW9w0OLg5u'),
  ('bob',    'bob@acme.com',    '$2b$10$Sd3GKFmu8.CRz86c3jQI5u3f.Lju4H3Ez5SSjTJjRAqMW9w0OLg5u'),
  ('carol',  'carol@acme.com',  '$2b$10$Sd3GKFmu8.CRz86c3jQI5u3f.Lju4H3Ez5SSjTJjRAqMW9w0OLg5u'),
  ('dave',   'dave@acme.com',   '$2b$10$Sd3GKFmu8.CRz86c3jQI5u3f.Lju4H3Ez5SSjTJjRAqMW9w0OLg5u'),
  ('eve',    'eve@acme.com',    '$2b$10$Sd3GKFmu8.CRz86c3jQI5u3f.Lju4H3Ez5SSjTJjRAqMW9w0OLg5u');

SELECT @alice_id := id FROM users WHERE email = 'alice@acme.com';
SELECT @bob_id   := id FROM users WHERE email = 'bob@acme.com';
SELECT @carol_id := id FROM users WHERE email = 'carol@acme.com';
SELECT @dave_id  := id FROM users WHERE email = 'dave@acme.com';
SELECT @eve_id   := id FROM users WHERE email = 'eve@acme.com';

-- =========================
-- Squads
-- =========================
INSERT INTO squads (workspace_id, name, created_by) VALUES
  (@workspace_id, 'Engineering',  @alice_id),
  (@workspace_id, 'Design',       @carol_id),
  (@workspace_id, 'Operations',   @dave_id);

SELECT @eng_squad  := id FROM squads WHERE name = 'Engineering';
SELECT @des_squad  := id FROM squads WHERE name = 'Design';
SELECT @ops_squad  := id FROM squads WHERE name = 'Operations';

-- =========================
-- Squad Members
-- =========================
INSERT INTO squad_members (squad_id, user_id, role, can_read, can_write, can_create_log, can_create_archive) VALUES
  (@eng_squad, @alice_id, 'owner',  TRUE, TRUE, TRUE, TRUE),
  (@eng_squad, @bob_id,   'member', TRUE, TRUE, TRUE, FALSE),
  (@eng_squad, @eve_id,   'member', TRUE, TRUE, TRUE, FALSE),
  (@des_squad, @carol_id, 'owner',  TRUE, TRUE, TRUE, TRUE),
  (@des_squad, @alice_id, 'member', TRUE, TRUE, TRUE, FALSE),
  (@ops_squad, @dave_id,  'owner',  TRUE, TRUE, TRUE, TRUE),
  (@ops_squad, @bob_id,   'member', TRUE, TRUE, FALSE, FALSE),
  (@ops_squad, @eve_id,   'member', TRUE, FALSE, FALSE, FALSE);

-- =========================
-- Permissions
-- =========================
INSERT INTO permissions (user_id, create_squad, create_archive, create_log) VALUES
  (@alice_id, TRUE,  TRUE,  TRUE),
  (@bob_id,   FALSE, TRUE,  TRUE),
  (@carol_id, FALSE, TRUE,  TRUE),
  (@dave_id,  FALSE, TRUE,  TRUE),
  (@eve_id,   FALSE, FALSE, TRUE);

-- =========================
-- Archives
-- =========================
INSERT INTO archives (squad_id, name, created_by, read_access, write_access) VALUES
  (@eng_squad, 'Platform API',            @alice_id, JSON_ARRAY(@alice_id, @bob_id, @carol_id, @dave_id, @eve_id), JSON_ARRAY(@alice_id, @bob_id, @eve_id)),
  (@eng_squad, 'Cloud Infrastructure',    @bob_id,   JSON_ARRAY(@alice_id, @bob_id, @carol_id, @dave_id, @eve_id), JSON_ARRAY(@alice_id, @bob_id)),
  (@eng_squad, 'Mobile App',              @alice_id, JSON_ARRAY(@alice_id, @bob_id, @carol_id, @dave_id, @eve_id), JSON_ARRAY(@alice_id, @bob_id, @eve_id)),
  (@des_squad, 'Brand Guidelines',        @carol_id, JSON_ARRAY(@alice_id, @bob_id, @carol_id, @dave_id, @eve_id), JSON_ARRAY(@alice_id, @carol_id)),
  (@des_squad, 'Website Redesign',        @carol_id, JSON_ARRAY(@alice_id, @bob_id, @carol_id, @dave_id, @eve_id), JSON_ARRAY(@alice_id, @carol_id)),
  (@ops_squad, 'Incident Runbooks',       @dave_id,  JSON_ARRAY(@alice_id, @bob_id, @carol_id, @dave_id, @eve_id), JSON_ARRAY(@alice_id, @dave_id, @bob_id)),
  (@ops_squad, 'Onboarding',             @dave_id,  JSON_ARRAY(@alice_id, @bob_id, @carol_id, @dave_id, @eve_id), JSON_ARRAY(@alice_id, @dave_id)),
  (@eng_squad, 'Data Pipeline',           @eve_id,   JSON_ARRAY(@alice_id, @bob_id, @carol_id, @dave_id, @eve_id), JSON_ARRAY(@alice_id, @eve_id, @bob_id));

SELECT @arch_api    := id FROM archives WHERE name = 'Platform API';
SELECT @arch_infra  := id FROM archives WHERE name = 'Cloud Infrastructure';
SELECT @arch_mobile := id FROM archives WHERE name = 'Mobile App';
SELECT @arch_brand  := id FROM archives WHERE name = 'Brand Guidelines';
SELECT @arch_web    := id FROM archives WHERE name = 'Website Redesign';
SELECT @arch_run    := id FROM archives WHERE name = 'Incident Runbooks';
SELECT @arch_onb    := id FROM archives WHERE name = 'Onboarding';
SELECT @arch_data   := id FROM archives WHERE name = 'Data Pipeline';

-- =========================
-- Logs — Platform API
-- =========================
INSERT INTO logs (archive_id, title, html_content, created_by, created_at) VALUES
(@arch_api, 'API Overview',
 '<h1>Platform API Overview</h1><p>The Platform API provides RESTful endpoints for managing resources across the Acme ecosystem. All requests require authentication via Bearer tokens.</p><h2>Base URL</h2><p><code>https://api.acme.com/v2</code></p><h2>Rate Limiting</h2><p>All endpoints enforce a rate limit of 1,000 requests per minute per API key. Exceeding this limit returns HTTP 429. Use exponential backoff for retries.</p><p>For batch operations, prefer the bulk endpoints documented in the Batch Operations section.</p>',
 @alice_id, '2025-11-01 09:00:00'),

(@arch_api, 'Authentication Guide',
 '<h1>Authentication</h1><p>The API supports two authentication methods: API keys and OAuth 2.0 bearer tokens.</p><h2>API Keys</h2><p>Generate API keys from the Developer Console. Include the key in the <code>X-API-Key</code> header. Keys can be scoped to specific resources and rotated without downtime.</p><h2>OAuth 2.0</h2><p>For user-context operations, use the authorization code flow. Redirect users to <code>/oauth/authorize</code> with your client ID and requested scopes. Token expiry is 3600 seconds.</p><h2>Scopes</h2><p>Available scopes: <code>read:resources</code>, <code>write:resources</code>, <code>admin:workspace</code>, <code>read:analytics</code>.</p>',
 @alice_id, '2025-11-02 10:30:00'),

(@arch_api, 'Error Handling',
 '<h1>Error Handling</h1><p>All error responses follow a consistent JSON structure with <code>error</code>, <code>message</code>, and <code>details</code> fields.</p><h2>Common Status Codes</h2><ul><li><strong>400</strong> — Bad Request: malformed input or validation failure</li><li><strong>401</strong> — Unauthorized: missing or invalid credentials</li><li><strong>403</strong> — Forbidden: insufficient permissions</li><li><strong>404</strong> — Not Found: resource does not exist</li><li><strong>429</strong> — Too Many Requests: rate limit exceeded</li><li><strong>500</strong> — Internal Server Error: unexpected failure</li></ul><p>Include a <code>request_id</code> header value when contacting support about specific errors.</p>',
 @bob_id, '2025-11-05 14:00:00'),

(@arch_api, 'Pagination Patterns',
 '<h1>Pagination</h1><p>List endpoints use cursor-based pagination for consistency and performance. Each response includes a <code>next_cursor</code> field when more results are available.</p><h2>Parameters</h2><ul><li><code>limit</code> — Number of results per log (1–100, default 25)</li><li><code>cursor</code> — Opaque cursor from previous response</li><li><code>sort</code> — Field to sort by (depends on endpoint)</li></ul><h2>Example</h2><p><code>GET /v2/archives?limit=10&cursor=eyJpZCI6NDJ9</code></p><p>Do not construct cursors manually — always use the value returned by the API.</p>',
 @bob_id, '2025-11-08 11:15:00'),

(@arch_api, 'Webhooks Configuration',
 '<h1>Webhooks</h1><p>Configure webhooks to receive real-time notifications when resources change. Webhooks deliver POST requests with a JSON payload signed using HMAC-SHA256.</p><h2>Setup</h2><p>Register webhook URLs in the Developer Console under Settings → Webhooks. Select which events to subscribe to (e.g., <code>resource.created</code>, <code>resource.updated</code>, <code>resource.deleted</code>).</p><h2>Verification</h2><p>Validate the <code>X-Signature-256</code> header against the payload using your webhook secret. Requests that fail verification should be rejected with HTTP 401.</p><h2>Retry Policy</h2><p>Failed deliveries are retried up to 5 times with exponential backoff over 24 hours.</p>',
 @alice_id, '2025-11-12 16:45:00'),

(@arch_api, 'Batch Operations',
 '<h1>Batch Operations</h1><p>For high-throughput use cases, the API provides batch endpoints that accept arrays of operations in a single request.</p><h2>Endpoint</h2><p><code>POST /v2/batch</code></p><h2>Request Format</h2><p>Send a JSON array of operation objects, each with <code>method</code>, <code>path</code>, and optional <code>body</code>. Maximum 100 operations per batch.</p><h2>Response</h2><p>Returns an array of results in the same order. Each result has <code>status</code>, <code>body</code>, and <code>headers</code>. Partial failures are possible — check each result individually.</p><p>Batch requests consume rate limit quota equal to the number of operations.</p>',
 @eve_id, '2025-11-18 08:30:00'),

(@arch_api, 'SDK Quick Start',
 '<h1>SDK Quick Start</h1><p>Official SDKs are available for JavaScript, Python, Go, and Ruby. Install via your language''s package manager.</p><h2>JavaScript</h2><p><code>npm install @acme/platform-sdk</code></p><pre><code>import { AcmeClient } from ''@acme/platform-sdk'';\nconst client = new AcmeClient({ apiKey: process.env.ACME_API_KEY });\nconst archives = await client.archives.list({ limit: 10 });</code></pre><h2>Python</h2><p><code>pip install acme-platform</code></p><pre><code>from acme import AcmeClient\nclient = AcmeClient(api_key=os.environ[''ACME_API_KEY''])\narchives = client.archives.list(limit=10)</code></pre>',
 @bob_id, '2025-12-01 09:00:00');

-- =========================
-- Logs — Cloud Infrastructure
-- =========================
INSERT INTO logs (archive_id, title, html_content, created_by, created_at) VALUES
(@arch_infra, 'Architecture Overview',
 '<h1>Cloud Architecture</h1><p>Our infrastructure runs on a multi-region Kubernetes cluster deployed across three availability zones. The architecture follows a microservices pattern with service mesh for inter-service communication.</p><h2>Key Components</h2><ul><li>API Gateway (Envoy-based)</li><li>Service mesh (Istio)</li><li>Message queue (Kafka)</li><li>Object storage (S3-compatible)</li><li>Relational database (Aurora MySQL)</li></ul><p>All services are containerized and deployed via Helm charts managed in the infrastructure monorepo.</p>',
 @bob_id, '2025-10-15 10:00:00'),

(@arch_infra, 'Kubernetes Cluster Setup',
 '<h1>Kubernetes Cluster Configuration</h1><p>Production clusters run Kubernetes 1.29 with containerd as the runtime. Node pools are segmented by workload type.</p><h2>Node Pools</h2><ul><li><strong>general</strong> — 8 vCPU / 32 GB, autoscales 3–20 nodes</li><li><strong>memory-optimized</strong> — 4 vCPU / 64 GB, for caching and analytics workloads</li><li><strong>gpu</strong> — A100 instances for ML inference, scales 0–4</li></ul><h2>Namespaces</h2><p>Each squad gets a dedicated namespace with resource quotas. Cross-namespace traffic is controlled via NetworkPolicies.</p>',
 @bob_id, '2025-10-22 11:45:00'),

(@arch_infra, 'CI/CD Pipeline',
 '<h1>CI/CD Pipeline</h1><p>We use GitHub Actions for CI and ArgoCD for continuous deployment to Kubernetes. Every pull request triggers a full test suite, linting, security scan, and container build.</p><h2>Pipeline Stages</h2><ol><li>Lint & type check</li><li>Unit tests</li><li>Integration tests (with test database)</li><li>Container image build & push</li><li>Security scan (Trivy)</li><li>ArgoCD sync to staging</li></ol><p>Production deploys require manual approval after staging validation passes. Canary deployments roll out to 10% of traffic before full promotion.</p>',
 @alice_id, '2025-11-03 14:20:00'),

(@arch_infra, 'Monitoring & Alerting',
 '<h1>Monitoring Stack</h1><p>Observability is built on the Prometheus + Grafana + Loki stack. Every service exposes metrics on <code>/metrics</code> and structured JSON logs.</p><h2>Key Dashboards</h2><ul><li>Service health — request rate, error rate, latency P50/P95/P99</li><li>Infrastructure — CPU, memory, disk, network per node</li><li>Business metrics — active users, API calls, revenue events</li></ul><h2>Alerting</h2><p>Critical alerts route to LogrDuty. Warning alerts go to Slack #ops-alerts. Alert fatigue is managed via weekly triage and rule tuning.</p>',
 @dave_id, '2025-11-10 09:30:00'),

(@arch_infra, 'Disaster Recovery Plan',
 '<h1>Disaster Recovery</h1><p>The DR plan targets an RPO of 1 hour and RTO of 4 hours for critical services. Database replication ensures near-real-time failover.</p><h2>Backup Strategy</h2><ul><li>Database: continuous replication to standby region + daily snapshots retained 30 days</li><li>Object storage: cross-region replication enabled</li><li>Configuration: GitOps — all infra state in version control</li></ul><h2>Failover Procedure</h2><p>DNS failover is automated via health checks. Database promotion requires a manual confirmation step to prevent split-brain scenarios. Full runbook in the Incident Runbooks archive.</p>',
 @dave_id, '2025-11-20 16:00:00'),

(@arch_infra, 'Terraform Module Guide',
 '<h1>Terraform Modules</h1><p>Infrastructure is provisioned via reusable Terraform modules stored in <code>infra/modules/</code>. Each module has its own README, input variables, and output values.</p><h2>Core Modules</h2><ul><li><code>vpc</code> — VPC with public/private subnets, NAT gateways</li><li><code>eks-cluster</code> — Managed Kubernetes cluster with node groups</li><li><code>rds</code> — Aurora MySQL cluster with read replicas</li><li><code>s3-bucket</code> — Encrypted bucket with lifecycle rules</li></ul><p>Pin module versions in your workspace <code>main.tf</code>. Run <code>terraform plan</code> in CI before any apply.</p>',
 @bob_id, '2025-12-05 10:15:00');

-- =========================
-- Logs — Mobile App
-- =========================
INSERT INTO logs (archive_id, title, html_content, created_by, created_at) VALUES
(@arch_mobile, 'App Architecture',
 '<h1>Mobile App Architecture</h1><p>The Acme mobile app is built with React Native targeting iOS and Android from a single codebase. State management uses Zustand with React Query for server state.</p><h2>Navigation</h2><p>React Navigation with a bottom tab navigator and stack navigators per tab. Deep linking is configured for push notification routing.</p><h2>Offline Support</h2><p>Critical data is cached in SQLite via WatermelonDB. Sync runs on app foreground and network reconnect events.</p>',
 @alice_id, '2025-11-05 08:00:00'),

(@arch_mobile, 'Push Notifications',
 '<h1>Push Notifications</h1><p>Notifications are delivered via Firebase Cloud Messaging (FCM) for Android and APNs for iOS. The backend sends notification payloads to our unified notification service.</p><h2>Notification Types</h2><ul><li><strong>Transactional</strong> — order confirmations, password resets</li><li><strong>Engagement</strong> — weekly digest, feature announcements</li><li><strong>Collaborative</strong> — mentions, comments, shared documents</li></ul><p>Users control notification preferences per category in Settings → Notifications.</p>',
 @eve_id, '2025-11-15 13:00:00'),

(@arch_mobile, 'Release Workflow',
 '<h1>Mobile Release Process</h1><p>Releases follow a two-week sprint cycle. Release branches are cut on Thursday, QA runs Friday through Monday, and submission happens Tuesday.</p><h2>Version Numbering</h2><p>Format: <code>MAJOR.MINOR.PATCH</code>. Major bumps require stakeholder sign-off. Minor bumps for feature releases. Patch for hotfixes.</p><h2>App Store Submission</h2><p>iOS: submitted via Xcode Cloud. Android: submitted via the Play Console API from CI. Both platforms require passing automated screenshot tests before submission.</p>',
 @alice_id, '2025-12-02 15:30:00'),

(@arch_mobile, 'Accessibility Guidelines',
 '<h1>Accessibility</h1><p>All new screens must meet WCAG 2.1 AA standards. This document covers the key requirements for mobile accessibility.</p><h2>Requirements</h2><ul><li>All interactive elements must have accessible labels</li><li>Minimum touch target size: 44×44 points</li><li>Color contrast ratio: 4.5:1 for text, 3:1 for large text</li><li>Support Dynamic Type / font scaling on both platforms</li><li>Screen reader navigation must follow logical reading order</li></ul><p>Run the Accessibility Inspector (iOS) and Accessibility Scanner (Android) before every PR.</p>',
 @carol_id, '2025-12-10 10:00:00');

-- =========================
-- Logs — Brand Guidelines
-- =========================
INSERT INTO logs (archive_id, title, html_content, created_by, created_at) VALUES
(@arch_brand, 'Logo Usage',
 '<h1>Logo Usage Guidelines</h1><p>The Acme logo is our most recognizable brand asset. Consistent usage builds trust and recognition.</p><h2>Versions</h2><ul><li><strong>Primary</strong> — Full color on light backgrounds</li><li><strong>Reversed</strong> — White on dark backgrounds</li><li><strong>Monochrome</strong> — Single color for limited-color contexts</li></ul><h2>Clear Space</h2><p>Maintain clear space equal to the height of the "A" in Acme on all sides. Never place the logo closer than this to other elements.</p><h2>Don''ts</h2><p>Do not stretch, rotate, add effects, change colors, or place on busy backgrounds.</p>',
 @carol_id, '2025-10-20 09:00:00'),

(@arch_brand, 'Color Palette',
 '<h1>Color Palette</h1><p>Our brand colors create a cohesive visual identity across all touchpoints.</p><h2>Primary Colors</h2><ul><li><strong>Acme Blue</strong> — #2CA7DB — used for primary actions, links, key UI elements</li><li><strong>Deep Navy</strong> — #1B2A4A — headings, body text on light backgrounds</li></ul><h2>Secondary Colors</h2><ul><li><strong>Success Green</strong> — #22C55E — confirmations, positive states</li><li><strong>Warning Amber</strong> — #F59E0B — caution states, pending actions</li><li><strong>Error Red</strong> — #EF4444 — errors, destructive actions</li></ul><h2>Neutrals</h2><p>Grey scale from #F8FAFC (lightest) to #0F172A (darkest). Use for backgrounds, borders, and secondary text.</p>',
 @carol_id, '2025-10-25 11:30:00'),

(@arch_brand, 'Typography',
 '<h1>Typography</h1><p>Consistent typography reinforces brand identity and ensures readability across platforms.</p><h2>Font Families</h2><ul><li><strong>Inter</strong> — Primary UI font for web and mobile</li><li><strong>JetBrains Mono</strong> — Code and technical content</li></ul><h2>Scale</h2><ul><li>Display: 36px / 700 weight</li><li>Heading 1: 28px / 700</li><li>Heading 2: 22px / 600</li><li>Body: 15px / 400</li><li>Caption: 13px / 400</li></ul><p>Line height: 1.5 for body, 1.3 for headings. Letter spacing: -0.01em for headings, normal for body.</p>',
 @carol_id, '2025-11-01 14:00:00'),

(@arch_brand, 'Illustration Style',
 '<h1>Illustration Style Guide</h1><p>Illustrations bring warmth and personality to our brand. They are used in onboarding flows, empty states, error logs, and marketing materials.</p><h2>Style Principles</h2><ul><li>Flat design with subtle gradients</li><li>Rounded shapes — no sharp corners</li><li>Limited palette — use brand colors only</li><li>People illustrations use abstract, inclusive representation</li></ul><h2>Usage</h2><p>Use illustrations sparingly in product UI — they should enhance, not distract. Maximum one illustration per screen. Marketing logs can use larger hero illustrations.</p>',
 @carol_id, '2025-11-15 16:30:00'),

(@arch_brand, 'Voice & Tone',
 '<h1>Voice & Tone</h1><p>Our brand voice is consistent. Our tone adapts to the situation.</p><h2>Voice Attributes</h2><ul><li><strong>Clear</strong> — Plain language, short sentences, no jargon</li><li><strong>Confident</strong> — Assertive but not arrogant</li><li><strong>Helpful</strong> — Guide users toward solutions</li><li><strong>Human</strong> — Conversational, approachable</li></ul><h2>Tone by Context</h2><ul><li><strong>Success</strong> — Celebratory, brief: "You''re all set!"</li><li><strong>Error</strong> — Empathetic, actionable: "Something went wrong. Try refreshing the log."</li><li><strong>Onboarding</strong> — Encouraging, warm: "Let''s get you started."</li></ul>',
 @alice_id, '2025-12-01 10:00:00');

-- =========================
-- Logs — Website Redesign
-- =========================
INSERT INTO logs (archive_id, title, html_content, created_by, created_at) VALUES
(@arch_web, 'Archive Kickoff Notes',
 '<h1>Website Redesign — Kickoff</h1><p>Meeting date: October 28, 2025. Attendees: Alice, Carol, Dave.</p><h2>Goals</h2><ul><li>Modernize visual design to match updated brand guidelines</li><li>Improve log load performance (target: LCP &lt; 2.5s)</li><li>Redesign navigation for better information architecture</li><li>Full accessibility audit and WCAG 2.1 AA compliance</li></ul><h2>Timeline</h2><p>Phase 1 (Design): Nov 1 – Nov 30. Phase 2 (Development): Dec 1 – Jan 31. Phase 3 (QA & Launch): Feb 1 – Feb 28.</p>',
 @carol_id, '2025-10-28 14:00:00'),

(@arch_web, 'Information Architecture',
 '<h1>Information Architecture</h1><p>The new site structure organizes content into four top-level sections with consistent navigation patterns.</p><h2>Site Map</h2><ul><li><strong>Product</strong> — Features, Pricing, Integrations, Changelog</li><li><strong>Solutions</strong> — By industry, by squad size, case studies</li><li><strong>Resources</strong> — Documentation, Blog, Community, Support</li><li><strong>Company</strong> — About, Careers, Press, Contact</li></ul><h2>Navigation</h2><p>Persistent top nav with mega-menu dropdowns. Mobile: hamburger menu with accordion sections. Footer mirrors top nav structure with additional legal links.</p>',
 @carol_id, '2025-11-05 10:00:00'),

(@arch_web, 'Performance Budget',
 '<h1>Performance Budget</h1><p>Performance targets ensure the redesigned site delivers a fast experience across devices and networks.</p><h2>Core Web Vitals Targets</h2><ul><li>Largest Contentful Paint (LCP): &lt; 2.5 seconds</li><li>First Input Delay (FID): &lt; 100 milliseconds</li><li>Cumulative Layout Shift (CLS): &lt; 0.1</li></ul><h2>Bundle Budget</h2><ul><li>Initial JS: &lt; 150 KB gzipped</li><li>Total log weight: &lt; 1 MB on first load</li><li>Fonts: &lt; 100 KB (subset and preload)</li></ul><p>Lighthouse CI runs on every PR and blocks merging if scores drop below 90.</p>',
 @alice_id, '2025-11-12 09:30:00'),

(@arch_web, 'Component Library Spec',
 '<h1>Component Library</h1><p>The redesign introduces a shared component library built on React with Tailwind CSS. Components are documented in Storybook.</p><h2>Core Components</h2><ul><li><code>Button</code> — primary, secondary, ghost, danger variants</li><li><code>Card</code> — standard, interactive, feature highlight</li><li><code>Modal</code> — centered overlay with backdrop blur</li><li><code>Input</code> — text, email, password, search with validation states</li><li><code>Table</code> — sortable columns, pagination, row selection</li></ul><h2>Design Tokens</h2><p>Colors, spacing, radii, and shadows are defined as CSS custom properties generated from a shared token config.</p>',
 @carol_id, '2025-11-20 15:00:00'),

(@arch_web, 'SEO Migration Plan',
 '<h1>SEO Migration Plan</h1><p>Migrating URLs requires careful redirect mapping to preserve search rankings and avoid broken links.</p><h2>Redirect Strategy</h2><p>All existing URLs are mapped to new equivalents in a CSV file. Cloudflare Workers handle 301 redirects. The mapping covers 847 existing logs.</p><h2>Checklist</h2><ul><li>Update XML sitemap and submit to Search Console</li><li>Verify canonical tags on all logs</li><li>Update internal links across all content</li><li>Monitor 404 rates for 30 days post-launch</li><li>Preserve structured data (JSON-LD) across migrations</li></ul>',
 @alice_id, '2025-12-08 11:00:00');

-- =========================
-- Logs — Incident Runbooks
-- =========================
INSERT INTO logs (archive_id, title, html_content, created_by, created_at) VALUES
(@arch_run, 'Database Failover',
 '<h1>Runbook: Database Failover</h1><p><strong>Severity:</strong> Critical. <strong>On-call:</strong> Infrastructure squad.</p><h2>Symptoms</h2><ul><li>API responses return 500 with database connection errors</li><li>Aurora cluster primary instance unreachable</li><li>Monitoring shows replication lag &gt; 30 seconds</li></ul><h2>Steps</h2><ol><li>Verify the issue via CloudWatch RDS metrics</li><li>Check Aurora event logs for failover initiation</li><li>If automatic failover hasn''t triggered, initiate manual failover via AWS Console</li><li>Verify application connectivity to new primary</li><li>Monitor replication catch-up on new replica</li></ol><h2>Post-Incident</h2><p>File incident report within 24 hours. Schedule root cause analysis meeting.</p>',
 @dave_id, '2025-10-18 08:00:00'),

(@arch_run, 'High CPU Alert',
 '<h1>Runbook: High CPU on Kubernetes Nodes</h1><p><strong>Severity:</strong> Warning → Critical if sustained. <strong>On-call:</strong> Infrastructure squad.</p><h2>Symptoms</h2><ul><li>Node CPU usage &gt; 85% for &gt; 5 minutes</li><li>Pod scheduling failures</li><li>Increased request latency</li></ul><h2>Steps</h2><ol><li>Identify the top CPU consumers: <code>kubectl top pods --sort-by=cpu</code></li><li>Check for runaway processes or infinite loops in recent deployments</li><li>If a specific pod, restart it: <code>kubectl delete pod &lt;name&gt;</code></li><li>If cluster-wide, check HPA status and manually scale if needed</li><li>Verify autoscaler is provisioning new nodes</li></ol>',
 @dave_id, '2025-10-25 14:30:00'),

(@arch_run, 'SSL Certificate Expiry',
 '<h1>Runbook: SSL Certificate Renewal</h1><p><strong>Severity:</strong> High. <strong>On-call:</strong> Infrastructure squad.</p><h2>Symptoms</h2><ul><li>Browser shows certificate warning for *.acme.com</li><li>Monitoring alert: certificate expires within 7 days</li></ul><h2>Steps</h2><ol><li>Check cert-manager logs: <code>kubectl logs -n cert-manager deploy/cert-manager</code></li><li>Verify DNS challenge is completing: check Cloudflare DNS records</li><li>If auto-renewal failed, manually trigger: <code>kubectl delete certificate acme-tls -n production</code></li><li>Verify new certificate issued: <code>kubectl get certificate -n production</code></li></ol><h2>Prevention</h2><p>Certificate expiry alerts are set at 30, 14, and 7 days. Investigate any 30-day alert immediately.</p>',
 @dave_id, '2025-11-08 10:00:00'),

(@arch_run, 'Memory Leak Investigation',
 '<h1>Runbook: Memory Leak Investigation</h1><p><strong>Severity:</strong> Warning. <strong>On-call:</strong> Application squad.</p><h2>Symptoms</h2><ul><li>Pod memory usage grows steadily over hours/days</li><li>OOMKilled events in pod status</li><li>Service restarts more frequently than normal</li></ul><h2>Steps</h2><ol><li>Confirm trend via Grafana memory dashboard (look at RSS, not just heap)</li><li>Enable heap profiling on the affected service</li><li>Capture heap snapshot: <code>kill -USR2 &lt;pid&gt;</code></li><li>Analyze with Chrome DevTools or <code>--prof</code> output</li><li>Check for common causes: unbounded caches, event listener leaks, unclosed connections</li></ol>',
 @bob_id, '2025-11-22 11:15:00'),

(@arch_run, 'Kafka Consumer Lag',
 '<h1>Runbook: Kafka Consumer Lag</h1><p><strong>Severity:</strong> Warning → High if lag grows. <strong>On-call:</strong> Data squad.</p><h2>Symptoms</h2><ul><li>Consumer group lag &gt; 10,000 messages</li><li>Delayed event processing visible in downstream systems</li></ul><h2>Steps</h2><ol><li>Check consumer group status: <code>kafka-consumer-groups.sh --describe --group &lt;name&gt;</code></li><li>Verify consumer pods are running and not crash-looping</li><li>Check for partition skew — rebalance if needed</li><li>If processing is slow, scale consumer replicas</li><li>If messages are poison pills, check dead letter queue</li></ol><h2>Escalation</h2><p>If lag exceeds 100,000 or grows faster than consumers can process, escalate to Critical.</p>',
 @eve_id, '2025-12-04 09:00:00');

-- =========================
-- Logs — Onboarding
-- =========================
INSERT INTO logs (archive_id, title, html_content, created_by, created_at) VALUES
(@arch_onb, 'Welcome to Acme',
 '<h1>Welcome to Acme!</h1><p>Congratulations on joining the squad. This guide will help you get set up and productive as quickly as possible.</p><h2>First Day</h2><ul><li>Set up your laptop using the IT Setup Guide</li><li>Join Slack and introduce yourself in #general</li><li>Schedule 1:1 with your manager</li><li>Complete HR paperwork in BambooHR</li></ul><h2>First Week</h2><ul><li>Complete all required training modules</li><li>Set up development environment (see Dev Setup Guide)</li><li>Shadow a squadmate on a real task</li><li>Ship your first PR (even if it''s a typo fix!)</li></ul>',
 @dave_id, '2025-10-10 09:00:00'),

(@arch_onb, 'Development Environment Setup',
 '<h1>Dev Environment Setup</h1><p>This guide walks through setting up your local development environment on macOS or Linux.</p><h2>Prerequisites</h2><ul><li>Homebrew (macOS) or apt (Linux)</li><li>Git with SSH key added to GitHub</li><li>Node.js 20 LTS via nvm</li><li>Docker Desktop</li><li>VS Code with recommended extensions</li></ul><h2>Steps</h2><ol><li>Clone the monorepo: <code>git clone git@github.com:acme/platform.git</code></li><li>Install dependencies: <code>npm install</code></li><li>Copy environment file: <code>cp .env.example .env</code></li><li>Start services: <code>docker compose up -d</code></li><li>Run the app: <code>npm run dev</code></li><li>Verify at <code>http://localhost:3000</code></li></ol>',
 @bob_id, '2025-10-12 10:30:00'),

(@arch_onb, 'Code Review Guidelines',
 '<h1>Code Review Guidelines</h1><p>Code review is how we maintain quality and share knowledge. Every change goes through review before merging.</p><h2>For Authors</h2><ul><li>Keep PRs small — under 400 lines when possible</li><li>Write a clear description explaining what and why</li><li>Self-review before requesting others</li><li>Link related issues and design docs</li></ul><h2>For Reviewers</h2><ul><li>Review within one business day</li><li>Focus on correctness, readability, and maintainability</li><li>Be kind — critique code, not people</li><li>Use "nit:" prefix for non-blocking suggestions</li><li>Approve when satisfied; don''t block on style preferences</li></ul>',
 @alice_id, '2025-10-18 14:45:00'),

(@arch_onb, 'Communication Norms',
 '<h1>Communication Norms</h1><p>Clear communication keeps the squad aligned and productive. Here''s how we work.</p><h2>Slack</h2><ul><li>Use threads for all replies</li><li>Use channels, not DMs, for work discussions (keeps context searchable)</li><li>Status emoji: 🟢 available, 🔴 focused/DND, 🏖️ OOO</li></ul><h2>Meetings</h2><ul><li>All meetings have an agenda shared 24 hours ahead</li><li>Default to 25 or 50 minutes (leave buffer)</li><li>Camera on for 1:1s and squad meetings, optional for large groups</li></ul><h2>Async by Default</h2><p>Write things down. Link to documents. Don''t assume everyone was in the room.</p>',
 @dave_id, '2025-11-01 09:00:00'),

(@arch_onb, 'Security Training',
 '<h1>Security Training</h1><p>All squad members must complete security training within their first two weeks. Security is everyone''s responsibility.</p><h2>Topics Covered</h2><ul><li>Password hygiene — use a password manager, unique passwords everywhere</li><li>Phishing awareness — verify sender, hover before clicking</li><li>Two-factor authentication — required on all company accounts</li><li>Data classification — public, internal, confidential, restricted</li><li>Incident reporting — see #security-incidents Slack channel</li></ul><h2>Development Security</h2><p>Review the OWASP Top 10. Never commit secrets. Use environment variables. Run <code>npm audit</code> regularly.</p>',
 @alice_id, '2025-11-10 11:00:00');

-- =========================
-- Logs — Data Pipeline
-- =========================
INSERT INTO logs (archive_id, title, html_content, created_by, created_at) VALUES
(@arch_data, 'Pipeline Architecture',
 '<h1>Data Pipeline Architecture</h1><p>The data pipeline ingests events from production services, transforms them, and loads into the analytics data warehouse.</p><h2>Flow</h2><ol><li>Services emit events to Kafka topics</li><li>Flink jobs consume, validate, and enrich events</li><li>Transformed data lands in S3 as Parquet files</li><li>Snowflake external tables expose data for queries</li><li>dbt models create clean analytical tables</li></ol><h2>Volume</h2><p>Average throughput: 50,000 events/second. Peak: 200,000 events/second during major launches. Daily data volume: ~2 TB uncompressed.</p>',
 @eve_id, '2025-11-01 08:00:00'),

(@arch_data, 'Schema Registry',
 '<h1>Schema Registry</h1><p>All Kafka messages are serialized with Avro and validated against schemas in Confluent Schema Registry. This ensures backward compatibility across producer and consumer versions.</p><h2>Conventions</h2><ul><li>Schema names follow: <code>&lt;domain&gt;.&lt;entity&gt;.&lt;action&gt;</code></li><li>All schemas include <code>event_id</code>, <code>timestamp</code>, and <code>version</code> fields</li><li>Backward-compatible changes only (add optional fields, never remove)</li></ul><h2>Workflow</h2><p>Schema changes go through PR review. CI validates compatibility before merge. Breaking changes require a new topic version.</p>',
 @eve_id, '2025-11-08 13:00:00'),

(@arch_data, 'dbt Model Guide',
 '<h1>dbt Model Guide</h1><p>We use dbt (data build tool) to transform raw data into clean analytical models in Snowflake.</p><h2>Archive Structure</h2><ul><li><code>staging/</code> — 1:1 with source tables, light cleaning only</li><li><code>intermediate/</code> — business logic transformations</li><li><code>marts/</code> — final tables consumed by BI tools and APIs</li></ul><h2>Naming Conventions</h2><ul><li>Staging: <code>stg_&lt;source&gt;__&lt;entity&gt;</code></li><li>Intermediate: <code>int_&lt;entity&gt;_&lt;verb&gt;</code></li><li>Marts: <code>fct_&lt;entity&gt;</code> or <code>dim_&lt;entity&gt;</code></li></ul><h2>Testing</h2><p>Every model must have <code>unique</code> and <code>not_null</code> tests on primary keys. Run <code>dbt test</code> locally before pushing.</p>',
 @eve_id, '2025-11-18 09:30:00'),

(@arch_data, 'Data Quality Framework',
 '<h1>Data Quality Framework</h1><p>Data quality is monitored at every stage of the pipeline to catch issues before they reach dashboards.</p><h2>Quality Dimensions</h2><ul><li><strong>Completeness</strong> — Are all expected records present?</li><li><strong>Freshness</strong> — Is data arriving on time?</li><li><strong>Validity</strong> — Do values meet schema constraints?</li><li><strong>Uniqueness</strong> — Are there unexpected duplicates?</li></ul><h2>Tooling</h2><p>Great Expectations runs nightly validation suites. Failures trigger Slack alerts and block downstream dbt runs. Anomaly detection flags statistical outliers in key metrics.</p>',
 @bob_id, '2025-12-01 14:00:00'),

(@arch_data, 'Analytics Event Catalog',
 '<h1>Analytics Event Catalog</h1><p>This catalog documents all tracked user events and their properties. Use this as a reference when adding new analytics or building reports.</p><h2>Core Events</h2><ul><li><code>log_viewed</code> — url, referrer, session_id, user_id</li><li><code>button_clicked</code> — button_name, log, context</li><li><code>form_submitted</code> — form_name, field_count, success</li><li><code>search_performed</code> — query, result_count, filters</li><li><code>document_created</code> — doc_id, archive_id, word_count</li><li><code>document_exported</code> — doc_id, format, word_count</li></ul><h2>Adding Events</h2><p>Propose new events via PR to the tracking plan repo. Include event name, description, properties with types, and sample payload.</p>',
 @eve_id, '2025-12-10 10:30:00'),

(@arch_data, 'Backfill Procedures',
 '<h1>Backfill Procedures</h1><p>When pipeline bugs cause data gaps or incorrect transformations, a backfill reprocesses historical data.</p><h2>Process</h2><ol><li>Identify the affected date range and tables</li><li>Create a backfill ticket with impact assessment</li><li>Write and test the backfill query/script locally</li><li>Run in staging environment first</li><li>Execute in production during low-traffic hours</li><li>Validate results against expected counts</li></ol><h2>Safety</h2><p>Always use <code>INSERT OVERWRITE</code> for idempotency. Never delete-then-insert — if the backfill fails mid-way, you''ll have data loss. Log all backfill operations to the audit table.</p>',
 @bob_id, '2025-12-15 08:45:00');

-- =========================
-- A few extra cross-archive logs for variety
-- =========================
INSERT INTO logs (archive_id, title, html_content, created_by, created_at) VALUES
(@arch_api, 'Rate Limiting Deep Dive',
 '<h1>Rate Limiting Implementation</h1><p>Our rate limiter uses a sliding window algorithm implemented in Redis. Each API key gets a separate counter with a 60-second window.</p><h2>Algorithm</h2><p>We use a sorted set per key with timestamps as scores. On each request: add current timestamp, remove entries older than the window, count remaining entries. If count exceeds limit, return 429.</p><h2>Headers</h2><ul><li><code>X-RateLimit-Limit</code> — Maximum requests per window</li><li><code>X-RateLimit-Remaining</code> — Requests remaining</li><li><code>X-RateLimit-Reset</code> — Unix timestamp when window resets</li></ul><p>Enterprise customers can request custom limits via their account manager.</p>',
 @alice_id, '2025-12-20 09:00:00'),

(@arch_infra, 'Secrets Management',
 '<h1>Secrets Management</h1><p>All secrets (API keys, database passwords, certificates) are stored in HashiCorp Vault and injected into pods via the Vault Agent sidecar.</p><h2>Access Policies</h2><ul><li>Secrets are scoped to namespaces — services can only read their own secrets</li><li>Dynamic database credentials rotate every 24 hours</li><li>PKI certificates are auto-renewed 7 days before expiry</li></ul><h2>Developer Workflow</h2><p>For local development, use <code>vault kv get</code> to retrieve values into your <code>.env</code>. Never commit secrets to Git. Pre-commit hooks scan for common secret patterns.</p>',
 @dave_id, '2025-12-22 14:30:00'),

(@arch_mobile, 'Performance Optimization',
 '<h1>Mobile Performance Optimization</h1><p>Performance directly impacts user retention. These guidelines help keep the app fast and responsive.</p><h2>Key Metrics</h2><ul><li>App launch to interactive: &lt; 2 seconds</li><li>Screen transitions: &lt; 300ms</li><li>Scroll frame rate: 60 FPS minimum</li></ul><h2>Techniques</h2><ul><li>Use <code>React.memo</code> and <code>useMemo</code> for expensive renders</li><li>Virtualize long lists with FlashList</li><li>Lazy-load images with progressive loading</li><li>Preload data for likely next screens</li><li>Minimize bridge traffic — batch native calls</li></ul><p>Profile regularly with Flipper and the React DevTools Profiler.</p>',
 @alice_id, '2025-12-28 10:00:00'),

(@arch_web, 'Analytics Integration',
 '<h1>Website Analytics Integration</h1><p>The redesigned website uses a privacy-first analytics approach with Plausible Analytics as the primary tool.</p><h2>Implementation</h2><p>The Plausible script is loaded asynchronously and weighs under 1 KB. No cookies are set, so no consent banner is required under GDPR.</p><h2>Custom Events</h2><ul><li><code>Signup Started</code> — user opens signup modal</li><li><code>Signup Completed</code> — account created successfully</li><li><code>CTA Clicked</code> — tracks which call-to-action buttons drive engagement</li><li><code>Doc Downloaded</code> — whitepaper or resource downloads</li></ul><h2>Dashboards</h2><p>Plausible dashboard is shared with marketing and product. Custom goals track conversion funnels.</p>',
 @carol_id, '2026-01-05 11:00:00'),

(@arch_run, 'API Gateway Troubleshooting',
 '<h1>Runbook: API Gateway Issues</h1><p><strong>Severity:</strong> Critical. <strong>On-call:</strong> Infrastructure squad.</p><h2>Symptoms</h2><ul><li>All API requests returning 502 or 503</li><li>Envoy proxy error logs showing upstream connection failures</li><li>Load balancer health checks failing</li></ul><h2>Steps</h2><ol><li>Check Envoy proxy pods: <code>kubectl get pods -n istio-system</code></li><li>Review Envoy access logs for upstream connection errors</li><li>Verify backend service pods are running and passing readiness probes</li><li>Check for recent Istio configuration changes</li><li>If Envoy is OOMing, increase memory limits in the deployment</li></ol><h2>Emergency</h2><p>If gateway is completely down, bypass via direct service NodePort as a temporary measure.</p>',
 @dave_id, '2026-01-10 08:30:00'),

(@arch_onb, 'Benefits Overview',
 '<h1>Employee Benefits Overview</h1><p>Acme offers comprehensive benefits to support your health, wealth, and well-being.</p><h2>Health</h2><ul><li>Medical, dental, and vision insurance (company covers 90% of premium)</li><li>$500 annual wellness stipend</li><li>Mental health support via Headspace and Spring Health</li></ul><h2>Financial</h2><ul><li>401(k) with 4% company match</li><li>Equity grants with 4-year vesting</li><li>Annual learning & development budget: $2,000</li></ul><h2>Time Off</h2><ul><li>Unlimited PTO (minimum 15 days encouraged)</li><li>Company-wide recharge weeks in July and December</li><li>12 weeks parental leave</li></ul>',
 @dave_id, '2026-01-15 09:00:00'),

(@arch_data, 'Cost Optimization Report',
 '<h1>Data Pipeline Cost Optimization</h1><p>Monthly Snowflake spend has grown 40% quarter-over-quarter. This document outlines optimization opportunities.</p><h2>Findings</h2><ul><li>3 dbt models run hourly but are only queried daily — reduce frequency</li><li>Large table scans in 12 dashboard queries — add clustering keys</li><li>Unused staging tables consuming 2 TB storage — archive or drop</li><li>XL warehouse used for simple queries — right-size warehouse</li></ul><h2>Archiveed Savings</h2><p>Implementing all recommendations: estimated 35% reduction in monthly compute costs and 20% reduction in storage costs. Total annual savings: ~$48,000.</p>',
 @eve_id, '2026-01-20 14:00:00');
