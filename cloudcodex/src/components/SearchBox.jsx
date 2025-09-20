import '../App.css'

function SearchBox() {
  return (
    <>
        <div className="search-box">
            <input type="text" placeholder="Search..." className="search-input" />
            <button className="search-button">Search</button>
        </div>
    </>
  )
}

export default SearchBox
