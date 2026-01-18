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
    const [searchTerm, setSearchTerm] = useState('');
    const [repoInfo, setRepoInfo] = useState(null);
    const [filteredFiles, setFilteredFiles] = useState([]);
    const containerRef = useRef(null);
    const [lastUrl, setLastUrl] = useState('');

    const fileTypeColors = {
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
        '.kt': '#A97BFF',
        '.sh': '#4a9c4a',
        '.yml': '#6b7280',
        '.yaml': '#6b7280',
        '.xml': '#f97316',
        '.sql': '#0369a1',
        '.dockerfile': '#0ea5e9',
        '.toml': '#8b5cf6'
    };

    const fileTypeIcons = {
        '.ts': 'TS', '.tsx': 'TSX', '.js': 'JS', '.jsx': 'JSX',
        '.css': 'CSS', '.scss': 'SASS', '.json': 'JSON', '.md': 'MD',
        '.html': 'HTML', '.py': 'PY', '.java': 'JAVA', '.cpp': 'C++',
        '.cs': 'C#', '.vue': 'VUE', '.php': 'PHP', '.rb': 'RUBY',
        '.go': 'GO', '.rs': 'RUST', '.kt': 'KOTLIN', '.sh': 'SHELL',
        '.yml': 'YML', '.yaml': 'YAML', '.xml': 'XML', '.sql': 'SQL',
        '.dockerfile': 'DOCKER', '.toml': 'TOML'
    };

    const getFileColor = (path) => {
        for (const [ext, color] of Object.entries(fileTypeColors)) {
            if (path.endsWith(ext)) return color;
        }
        return '#6b7280';
    };

    const getFileIcon = (path) => {
        for (const [ext, icon] of Object.entries(fileTypeIcons)) {
            if (path.endsWith(ext)) return icon;
        }
        return 'FILE';
    };

    const analyzeGithub = async (githubUrl = null) => {
        const urlToAnalyze = githubUrl || url;
        if (!urlToAnalyze) {
            setError('Por favor, insira uma URL do GitHub');
            return;
        }

        const match = urlToAnalyze.match(/github\.com\/([^/]+)\/([^/]+)/);
        if (!match) {
            setError('URL do GitHub inválida. Formato esperado: https://github.com/usuario/repositorio');
            return;
        }

        const [_, owner, repo] = match;
        const currentRepo = `${owner}/${repo}`;
        
        // Evitar requisições duplicadas
        if (lastUrl === currentRepo && files.length > 0) {
            setStatus('Repositório já carregado');
            return;
        }

        setLoading(true);
        setStatus('🔍 Conectando ao GitHub...');
        setError(null);
        setLastUrl(currentRepo);

        try {
            // Primeiro, obter informações do repositório
            const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (!repoRes.ok) {
                if (repoRes.status === 404) {
                    throw new Error('Repositório não encontrado');
                }
                throw new Error(`Erro ${repoRes.status}: ${repoRes.statusText}`);
            }

            const repoData = await repoRes.json();
            setRepoInfo({
                name: repoData.name,
                description: repoData.description,
                stars: repoData.stargazers_count,
                forks: repoData.forks_count,
                language: repoData.language,
                owner: repoData.owner.login
            });

            // Obter estrutura do repositório
            let branch = 'main';
            const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
            
            console.log('Buscando dados da API:', apiUrl);
            
            const res = await fetch(apiUrl, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (!res.ok) {
                if (res.status === 404) {
                    // Tentar com a branch master
                    branch = 'master';
                    const res2 = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, {
                        headers: {
                            'Accept': 'application/vnd.github.v3+json'
                        }
                    });
                    
                    if (!res2.ok) {
                        throw new Error('Repositório vazio ou não encontrado');
                    }
                    
                    const data = await res2.json();
                    processRepositoryData(data, owner, repo, branch);
                    return;
                } else if (res.status === 403) {
                    throw new Error('Limite de requisições excedido. Aguarde alguns minutos.');
                }
                throw new Error(`Erro ${res.status}: ${res.statusText}`);
            }

            const data = await res.json();
            processRepositoryData(data, owner, repo, branch);
            
        } catch (err) {
            console.error('Erro:', err);
            setError(err.message);
            setStatus('❌ Erro na conexão');
            setFiles([]);
            setFilteredFiles([]);
            setLoading(false);
        }
    };

    const processRepositoryData = (data, owner, repo, branch) => {
        if (!data.tree) {
            throw new Error('Estrutura do repositório não encontrada');
        }

        const fileList = data.tree
            .filter(f => f.type === 'blob')
            .map(f => ({
                ...f,
                extension: f.path.split('.').pop().toLowerCase(),
                sizeKB: Math.round((f.size || 1024) / 1024 * 10) / 10
            }))
            .filter(f => {
                const path = f.path.toLowerCase();
                return !path.includes('node_modules') && 
                       !path.includes('dist') && 
                       !path.includes('build') &&
                       !path.includes('.git') &&
                       !path.startsWith('.');
            })
            .slice(0, 150); // Aumentado para 150 arquivos

        if (fileList.length === 0) {
            setError('Nenhum arquivo encontrado no repositório');
            setFiles([]);
            setFilteredFiles([]);
            setStatus('⚠️ Repositório vazio ou sem arquivos visíveis');
            setLoading(false);
            return;
        }

        setRepoBase(`https://github.com/${owner}/${repo}`);
        setFiles(fileList);
        setFilteredFiles(fileList);
        setStatus(`✅ ${fileList.length} arquivos encontrados!`);
        setLoading(false);
        setZoom(1);
        setOffset({ x: 0, y: 0 });
    };

    // Filtrar arquivos baseado na busca
    useEffect(() => {
        if (!searchTerm.trim()) {
            setFilteredFiles(files);
            return;
        }

        const searchLower = searchTerm.toLowerCase();
        const filtered = files.filter(f => 
            f.path.toLowerCase().includes(searchLower) ||
            f.extension.includes(searchLower)
        );
        setFilteredFiles(filtered);
    }, [searchTerm, files]);

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
        if (e.button === 0 && e.target.className.includes('visualization-container')) {
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

    // Calcular estatísticas
    const calculateStats = () => {
        if (files.length === 0) return null;
        
        const stats = {
            totalFiles: files.length,
            totalSizeKB: files.reduce((sum, f) => sum + f.sizeKB, 0),
            byExtension: {}
        };

        files.forEach(f => {
            stats.byExtension[f.extension] = (stats.byExtension[f.extension] || 0) + 1;
        });

        return stats;
    };

    const stats = calculateStats();

    // Exemplos de repositórios populares
    const examples = [
        { name: 'React', url: 'https://github.com/facebook/react' },
        { name: 'Vue.js', url: 'https://github.com/vuejs/vue' },
        { name: 'VS Code', url: 'https://github.com/microsoft/vscode' },
        { name: 'Next.js', url: 'https://github.com/vercel/next.js' },
        { name: 'Node.js', url: 'https://github.com/nodejs/node' },
        { name: 'TypeScript', url: 'https://github.com/microsoft/TypeScript' }
    ];

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

    // Renderizar legenda
    const renderLegend = () => {
        const commonExtensions = Object.entries(fileTypeColors)
            .filter(([ext]) => files.some(f => f.path.endsWith(ext)))
            .slice(0, 10);

        if (commonExtensions.length === 0) return null;

        return React.createElement('div', { className: 'legend' }, [
            React.createElement('h4', { key: 'title' }, 'Legenda de Cores'),
            React.createElement('div', { 
                key: 'items',
                className: 'legend-items'
            }, commonExtensions.map(([ext, color]) => 
                React.createElement('div', { 
                    key: ext,
                    className: 'legend-item'
                }, [
                    React.createElement('div', {
                        key: 'color',
                        className: 'legend-color',
                        style: { background: color }
                    }),
                    React.createElement('span', { key: 'label' }, ext)
                ])
            ))
        ]);
    };

    // Renderizar controles
    const renderControls = () => {
        return React.createElement('div', { className: 'controls' }, [
            React.createElement('button', {
                key: 'zoom-in',
                onClick: handleZoomIn,
                title: 'Zoom In'
            }, '+'),
            React.createElement('button', {
                key: 'zoom-out',
                onClick: handleZoomOut,
                title: 'Zoom Out'
            }, '−'),
            React.createElement('button', {
                key: 'reset',
                onClick: handleResetView,
                title: 'Reset View'
            }, '⟲')
        ]);
    };

    // Renderizar nós de arquivos
    const renderFileNodes = () => {
        if (filteredFiles.length === 0) {
            return React.createElement('div', { className: 'empty-state' }, [
                React.createElement('h3', { key: 'title' }, 'Nenhum arquivo encontrado'),
                React.createElement('p', { key: 'message' }, 
                    searchTerm ? 
                    'Nenhum arquivo corresponde à sua busca. Tente outro termo.' :
                    'Insira uma URL do GitHub para visualizar a estrutura do repositório.'
                )
            ]);
        }

        const positions = calculateGridPositions(filteredFiles.length);
        
        return filteredFiles.map((file, index) => {
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
                }, file.path.length > 40 ? '...' + file.path.slice(-40) : file.path),
                React.createElement('div', {
                    key: 'size',
                    className: 'file-size'
                }, `${file.sizeKB} KB`)
            ]);
        });
    };

    // Renderizar interface principal
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
                }, 'Visualize a estrutura de qualquer repositório GitHub')
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
                    onClick: () => analyzeGithub(),
                    disabled: loading
                }, loading ? [
                    React.createElement('span', {
                        key: 'spinner',
                        className: 'loading-spinner'
                    }),
                    'PROCESSANDO...'
                ] : '🔍 ANALISAR')
            ]),
            
            files.length > 0 && React.createElement('div', {
                key: 'search',
                className: 'search-box'
            }, [
                React.createElement('input', {
                    key: 'search-input',
                    placeholder: '🔍 Filtrar arquivos por nome ou extensão...',
                    value: searchTerm,
                    onChange: e => setSearchTerm(e.target.value)
                })
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
            
            repoInfo && React.createElement('div', {
                key: 'repo-info',
                className: 'repo-info'
            }, [
                React.createElement('div', {
                    key: 'name',
                    style: { fontWeight: 'bold', marginBottom: '5px' }
                }, `${repoInfo.owner}/${repoInfo.name}`),
                repoInfo.description && React.createElement('div', {
                    key: 'desc',
                    style: { fontSize: '11px', marginBottom: '5px' }
                }, repoInfo.description),
                React.createElement('div', {
                    key: 'stats',
                    className: 'stats-grid'
                }, [
                    React.createElement('div', { key: 'lang' }, [
                        React.createElement('span', { key: 'label' }, 'Linguagem: '),
                        React.createElement('span', { key: 'value' }, repoInfo.language || 'Várias')
                    ]),
                    React.createElement('div', { key: 'stars' }, [
                        React.createElement('span', { key: 'label' }, '⭐ '),
                        React.createElement('span', { key: 'value' }, repoInfo.stars)
                    ]),
                    React.createElement('div', { key: 'forks' }, [
                        React.createElement('span', { key: 'label' }, '🍴 '),
                        React.createElement('span', { key: 'value' }, repoInfo.forks)
                    ]),
                    React.createElement('div', { key: 'files' }, [
                        React.createElement('span', { key: 'label' }, '📁 '),
                        React.createElement('span', { key: 'value' }, `${filteredFiles.length}/${files.length}`)
                    ])
                ])
            ]),
            
            files.length === 0 && React.createElement('div', {
                key: 'examples',
                className: 'examples'
            }, [
                React.createElement('p', {
                    key: 'label',
                    style: { width: '100%', textAlign: 'center', fontSize: '12px', margin: '10px 0' }
                }, 'Experimente com:'),
                ...examples.map((example, i) =>
                    React.createElement('button', {
                        key: `example-${i}`,
                        className: 'example-btn',
                        onClick: () => {
                            setUrl(example.url);
                            setTimeout(() => analyzeGithub(example.url), 100);
                        }
                    }, example.name)
                )
            ])
        ]),

        files.length > 0 && renderLegend(),
        
        React.createElement('div', {
            key: 'visualization',
            ref: containerRef,
            className: 'visualization-container',
            onMouseDown: handleMouseDown,
            style: { 
                cursor: isDragging ? 'grabbing' : 'grab',
                overflow: 'auto'
            }
        }, React.createElement('div', {
            key: 'nodes-container',
            style: {
                position: 'relative',
                width: '100%',
                height: '100%',
                minHeight: '800px'
            }
        }, renderFileNodes())),

        filteredFiles.length > 0 && renderControls()
    ]);
}

// Inicialização da aplicação
document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('app');
    if (container && React && ReactDOM) {
        try {
            const root = createRoot(container);
            root.render(React.createElement(App));
            
            // Adicionar favicon dinamicamente
            const link = document.createElement('link');
            link.rel = 'icon';
            link.href = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🗺️</text></svg>';
            document.head.appendChild(link);
            
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
});
