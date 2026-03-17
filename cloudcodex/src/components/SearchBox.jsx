import { getSearchResults } from '../util';
import { useRef } from 'react';

export default function SearchBox() {
  const inputRef = useRef(null);

  const handleSearch = () => {
    if (inputRef.current?.value) {
      getSearchResults(inputRef.current.value);
    }
  };

  return (
    <section className="search-section">
      <div className="search-card">
        <label htmlFor="search" className="search-label">
          Search for Documents
        </label>
        <div className="search-box">
          <input
            ref={inputRef}
            type="text"
            placeholder="Search..."
            className="search-input"
            id="search"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          />
          <button className="c2-btn search-button" onClick={handleSearch}>
            Search
          </button>
        </div>
      </div>
    </section>
  );
}