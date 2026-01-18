const { useState, useEffect, useRef } = React;
const { createRoot } = ReactDOM;

function App() {
    const [url, setUrl] = useState('');
    const [files, setFiles] = useState([]);
    const [status, setStatus] = useState('Pronto para analisar');
    const [repoBase, setRepoBase] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const containerRef = useRef(null);

    const getFileColor = (path) => {
        const colorMap = {
            '.ts': '#1e40af',
            '.tsx': '#1d4ed8',
            '.jsx': '#06b6d4',
            '.js': '#3b82f6',
            '.css': '#8b5cf6',
            '.scss': '#7c3aed',
            '.json': '#f59e0b',
            '.md': '#10b981',
            '.html': '#ef4444',
            '.py': '#3b82f6',
            '.java': '#dc2626',
            '.cpp': '#059669',
            '.cs': '#4f46e5',
            '.vue': '#10b981',
            '.php': '#777bb4',
            '.rb': '#701516',
            '.go': '#00ADD8',
            '.rs': '#dea584',
            '.kt': '#A97BFF'
        };
        
        for (const [ext, color] of Object.entries(colorMap)) {
            if (path.endsWith(ext)) return color;
        }
        return '#6b7280';
    };

    const getFileIcon = (path) => {
        if (path.endsWith('.ts')) return 'TS';
        if (path.endsWith('.tsx')) return 'TSX';
        if (path.endsWith('.js')) return 'JS';
        if (path.endsWith('.jsx')) return 'JSX';
        if (path.endsWith('.css')) return 'CSS';
        if (path.endsWith('.scss')) return 'SASS';
        if (path.endsWith('.json')) return 'JSON';
        if (path.endsWith('.md')) return 'MD';
        if (path.endsWith('.html')) return 'HTML';
        if (path.endsWith('.py')) return 'PY';
        if (path.endsWith('.java')) return 'JAVA';
        if (path.endsWith('.cpp')) return 'C++';
        if (path.endsWith('.cs')) return 'C#';
        if (path.endsWith('.vue')) return 'VUE';
        if (path.endsWith('.php')) return 'PHP';
        if (path.endsWith('.rb')) return 'RUBY';
        if (path.endsWith('.go')) return 'GO';
        if (path.endsWith('.rs')) return 'RUST';
        if (path.endsWith('.kt')) return 'KOTLIN';
        return 'FILE';
    };

    const analyzeGithub = async () => {
        if (!url) {
            setError('Por favor, insira uma URL do GitHub');
            return;
        }

        const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
        if (!match) {
            setError('URL do GitHub inválida. Formato esperado: https://github.com/usuario/repositorio');
            return;
        }

        setLoading(true);
        setStatus('🔍 Conectando ao GitHub...');
        setError(null);

        try {
            const [_, owner, repo] = match;
            const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`;
            
            console.log('Buscando dados da API:', apiUrl);
            
            const res = await fetch(apiUrl, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (!res.ok) {
                if (res.status === 404) {
                    // Tentar com a branch master se main não existir
                    const res2 = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/master?recursive=1`, {
                        headers: {
                            'Accept': 'application/vnd.github.v3+json'
                        }
                    });
                    
                    if (!res2.ok) {
                        throw new Error('Repositório não encontrado. Verifique se o nome está correto.');
                    }
                    
                    const data = await res2.json();
                    processRepositoryData(data, owner, repo);
                    return;
                } else if (res.status === 403) {
                    throw new Error('Limite de requisições excedido. Tente novamente mais tarde.');
                }
                throw new Error(`Erro ${res.status}: ${res.statusText}`);
            }

            const data = await res.json();
            processRepositoryData(data, owner, repo);
            
        } catch (err) {
            console.error('Erro:', err);
            setError(err.message);
            setStatus('❌ Erro na conexão');
            setFiles([]);
            setLoading(false);
        }
    };

    const processRepositoryData = (data, owner, repo) => {
        if (!data.tree) {
            throw new Error('Estrutura do repositório não encontrada');
        }

        const fileList = data.tree
            .filter(f => f.type === 'blob' && f.path.match(/\.(js|ts|jsx|tsx|css|scss|json|md|html|py|java|cpp|cs|vue|php|rb|go|rs|kt)$/))
            .filter(f => !f.path.includes('node_modules') && 
                        !f.path.includes('dist') && 
                        !f.path.includes('build') &&
                        !f.path.includes('.git'))
            .slice(0, 100);

        if (fileList.length === 0) {
            setError('Nenhum arquivo de código encontrado no repositório');
            setFiles([]);
            setStatus('⚠️ Nenhum arquivo encontrado');
            setLoading(false);
            return;
        }

        setRepoBase(`https://github.com/${owner}/${repo}`);
        setFiles(fileList);
        setStatus(`✅ ${fileList.length} arquivos encontrados!`);
        setLoading(false);
        setZoom(1);
        setOffset({ x: 0, y: 0 });
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !loading) {
            analyzeGithub();
        }
    };

    const handleFileClick = (filePath) => {
        if (repoBase) {
            window.open(`${repoBase}/blob/main/${filePath}`, '_blank');
        }
    };

    const handleZoomIn = () => {
        setZoom(prev => Math.min(prev + 0.1, 2));
    };

    const handleZoomOut = () => {
        setZoom(prev => Math.max(prev - 0.1, 0.5));
    };

    const handleResetView = () => {
        setZoom(1);
        setOffset({ x: 0, y: 0 });
    };

    const handleMouseDown = (e) => {
        if (e.button === 0) { // Botão esquerdo do mouse
            setIsDragging(true);
            setDragStart({
                x: e.clientX - offset.x,
                y: e.clientY - offset.y
            });
        }
    };

    const handleMouseMove = (e) => {
        if (!isDragging) return;
        
        setOffset({
            x: e.clientX - dragStart.x,
            y: e.clientY - dragStart.y
        });
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    // Adicionar event listeners para drag
    useEffect(() => {
        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            return () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isDragging]);

    // Calcular posições dos nós em grid
    const calculateGridPositions = (fileCount) => {
        const positions = [];
        const columns = Math.ceil(Math.sqrt(fileCount));
        
        for (let i = 0; i < fileCount; i++) {
            const row = Math.floor(i / columns);
            const col = i % columns;
            positions.push({
                x: col * 220,
                y: row * 140
            });
        }
        
        return positions;
    };

    // Renderizar nós
    const renderFileNodes = () => {
        if (files.length === 0) return null;

        const positions = calculateGridPositions(files.length);
        
        return files.map((file, index) => {
            const position = positions[index];
            const scaledX = position.x * zoom + offset.x;
            const scaledY = position.y * zoom + offset.y;

            return React.createElement('div', {
                key: index,
                className: 'file-node',
                onClick: () => handleFileClick(file.path),
                style: {
                    position: 'absolute',
                    left: `${scaledX}px`,
                    top: `${scaledY}px`,
                    background: getFileColor(file.path),
                    transform: `scale(${zoom})`,
                    transformOrigin: 'top left',
                    width: '200px',
                    zIndex: 1
                }
            }, [
                React.createElement('div', {
                    key: 'icon',
                    className: 'file-icon'
                }, getFileIcon(file.path)),
                React.createElement('div', {
                    key: 'name',
                    className: 'file-name'
                }, file.path.split('/').pop()),
                React.createElement('div', {
                    key: 'path',
                    className: 'file-path'
                }, file.path.length > 40 ? '...' + file.path.slice(-40) : file.path)
            ]);
        });
    };

    return React.createElement('div', { 
        style: { width: '100%', height: '100%', position: 'relative' } 
    }, [
        React.createElement('div', { 
            key: 'ui-layer',
            className: 'ui-layer'
        }, [
            React.createElement('div', { 
                key: 'header',
                style: { marginBottom: '15px' }
            }, [
                React.createElement('h3', { 
                    key: 'title',
                    style: { margin: '0 0 10px 0', color: '#f8fafc' }
                }, 'GitHub Repository Mapper'),
                React.createElement('p', { 
                    key: 'subtitle',
                    style: { fontSize: '12px', color: '#94a3b8', margin: '0' }
                }, 'Insira a URL de um repositório GitHub para visualizar sua estrutura')
            ]),
            React.createElement('div', { 
                key: 'input-group',
                className: 'input-group'
            }, [
                React.createElement('input', { 
                    key: 'input',
                    placeholder: 'https://github.com/usuario/projeto',
                    value: url,
                    onChange: e => setUrl(e.target.value),
                    onKeyPress: handleKeyPress,
                    disabled: loading
                }),
                React.createElement('button', { 
                    key: 'button',
                    onClick: analyzeGithub,
                    disabled: loading
                }, loading ? 'PROCESSANDO...' : 'GERAR MAPA')
            ]),
            React.createElement('div', { 
                key: 'status-box',
                className: `status-box ${error ? 'error' : ''}`
            }, [
                React.createElement('strong', { key: 'label' }, 'Status: '),
                status,
                error && React.createElement('div', { 
                    key: 'error',
                    style: { marginTop: '8px', fontSize: '13px' }
                }, error)
            ]),
            files.length > 0 && React.createElement('div', { 
                key: 'tip-box',
                className: 'tip-box'
            }, [
                React.createElement('strong', { key: 'tip' }, 'Dica: '),
                'Clique em qualquer arquivo para abrir no GitHub',
                React.createElement('div', { 
                    key: 'count',
                    style: { marginTop: '5px' }
                }, `${files.length} arquivos encontrados • Zoom: ${zoom.toFixed(1)}x`)
            ])
        ]),

        React.createElement('div', {
            key: 'visualization',
            ref: containerRef,
            className: 'visualization-container',
            onMouseDown: handleMouseDown,
            style: { 
                cursor: isDragging ? 'grabbing' : 'grab',
                overflow: 'auto'
            }
        }, files.length > 0 && [
            React.createElement('div', {
                key: 'nodes-container',
                style: {
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                    minHeight: '800px'
                }
            }, renderFileNodes())
        ]),

        files.length > 0 && React.createElement('div', {
            key: 'controls',
            className: 'controls'
        }, [
            React.createElement('button', {
                key: 'zoom-in',
                onClick: handleZoomIn
            }, '+'),
            React.createElement('button', {
                key: 'zoom-out',
                onClick: handleZoomOut
            }, '-'),
            React.createElement('button', {
                key: 'reset',
                onClick: handleResetView
            }, 'Reset')
        ])
    ]);
}

// Renderização
const container = document.getElementById('app');
if (container && React && ReactDOM) {
    try {
        const root = createRoot(container);
        root.render(React.createElement(App));
    } catch (error) {
        console.error('Erro ao renderizar aplicação:', error);
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #dc2626;">
                <h3>Erro ao carregar a aplicação</h3>
                <p>${error.message}</p>
                <button onclick="window.location.reload()" style="padding: 10px 20px; margin-top: 20px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer;">
                    Recarregar Página
                </button>
            </div>
        `;
    }
} else {
    console.error('React ou container não encontrados');
}
