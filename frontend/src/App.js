import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import Layout from "@/components/Layout";
import Home from "@/pages/Home";
import Company from "@/pages/Company";
import Watchlist from "@/pages/Watchlist";
import Compare from "@/pages/Compare";

function App() {
    return (
        <div className="App">
            <BrowserRouter>
                <Layout>
                    <Routes>
                        <Route path="/" element={<Home />} />
                        <Route path="/company/:ticker" element={<Company />} />
                        <Route path="/watchlist" element={<Watchlist />} />
                        <Route path="/compare" element={<Compare />} />
                    </Routes>
                </Layout>
                <Toaster position="bottom-right" toastOptions={{ style: { borderRadius: 0, border: "1px solid #111", fontFamily: "IBM Plex Sans" } }} />
            </BrowserRouter>
        </div>
    );
}

export default App;
