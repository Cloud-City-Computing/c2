/**
 * Cloud Codex - Search Page
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import SearchBox from '../components/SearchBox';
import StdLayout from '../page_layouts/Std_Layout';

/**
 * Facilitates searching and displays results alongside the necessary UI components.
 * @returns { JSX.Element }
 */
function HomePage() {
  return (
    <>
      <StdLayout>
        <SearchBox />
        <section className="results-section">
          <div id="resultPreviewContainer"></div>
        </section>
      </StdLayout>
    </>
  )
}

export default HomePage
