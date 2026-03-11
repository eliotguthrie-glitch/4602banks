import { StrictMode, Component } from "react"
import { createRoot } from "react-dom/client"
import App from "./App.jsx"

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding:40,fontFamily:"system-ui",maxWidth:600,margin:"0 auto"}}>
          <h2 style={{color:"#c33",marginBottom:12}}>Something went wrong</h2>
          <pre style={{background:"#f5f5f5",padding:16,borderRadius:8,fontSize:12,overflow:"auto",marginBottom:16,whiteSpace:"pre-wrap"}}>{this.state.error?.message || String(this.state.error)}</pre>
          <button onClick={()=>{localStorage.removeItem("4602banks_dev_data");location.reload();}}
            style={{padding:"10px 20px",fontSize:14,cursor:"pointer",background:"#2563eb",color:"#fff",border:"none",borderRadius:6,marginRight:8}}>
            Reset dev data &amp; reload
          </button>
          <button onClick={()=>{this.setState({error:null});}}
            style={{padding:"10px 20px",fontSize:14,cursor:"pointer",background:"#eee",border:"1px solid #ccc",borderRadius:6}}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>)
