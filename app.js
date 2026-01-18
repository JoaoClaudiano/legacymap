const { useState, useEffect } = React;

function App() {
    const [ready, setReady] = useState(false);
    const [url, setUrl] = useState('');
    const [nodes, setNodes] = useState([]);
    const [edges, setEdges] = useState([]);

    useEffect(() => {
        const check = setInterval(() => {
            if (window.ReactFlow) {
                setReady(true);
                clearInterval(check);
            }
        }, 200);
        return () => clearInterval(check);
    }, []);

    if (!ready) return <div className="loading">Carregando motor gráfico...</div>;

    const RF = window.ReactFlow.default || window.ReactFlow;
    const { Background, Controls } = window.ReactFlow;

    const analyze = async () => {
        // Lógica de fetch que criamos anteriormente
        console.log("Analisando:", url);
    };

    return (
        <div style={{ width: '100vw', height: 'calc(100vh - 100px)' }}>
            <div id="ui-layer">
                <div className="input-group">
                    <label>Link do Repositório</label>
                    <input 
                        type="text" 
                        placeholder="https://github.com/..." 
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                    />
                    <button onClick={analyze}>Mapear Agora</button>
                </div>
            </div>

            <RF nodes={nodes} edges={edges} fitView>
                <Background color="#334155" gap={20} />
                <Controls />
            </RF>
        </div>
    );
}

const root = ReactDOM.createRoot(document.getElementById('app'));
root.render(<App />);
