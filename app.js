const { useState, useEffect, useRef } = React;
const { createRoot } = ReactDOM;

// ==================== COMPONENTE TREE NODE ====================
const TreeNode = ({ node, repoBase, level = 0, searchTerm = '', onNodeClick, highlightNodes = [] }) => {
    const [isOpen, setIsOpen] = useState(level < 2);
    const hasChildren = node.children && node.children.length > 0;
    const isFolder = node.type === 'folder';
    const isHighlighted = highlightNodes.includes(node.id);
    
    const isVisible = !searchTerm || 
        node.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (node.children && node.children.some(child => 
            child.name.toLowerCase().includes(searchTerm.toLowerCase())
        ));
    
    if (!isVisible && searchTerm) return null;
    
    const visibleChildren = searchTerm && node.children ? 
        node.children.filter(child => 
            child.name.toLowerCase().includes(searchTerm.toLowerCase())
        ).length : 
        (node.children ? node.children.length : 0);
    
    return React.createElement('div', {
        className: 'tree-node',
        style: { 
            marginLeft: `${level * 20}px`,
            display: searchTerm && !isVisible ? 'none' : 'block'
        }
    }, [
        React.createElement('div', {
            key: 'header',
            className: `tree-node-header ${isFolder ? 'folder' : 'file'} ${isHighlighted ? 'highlighted' : ''}`,
            onClick: () => {
                if (isFolder) {
                    setIsOpen(!isOpen);
                } else if (onNodeClick) {
                    onNodeClick(node);
                }
            },
            style: { 
                cursor: isFolder ? 'pointer' : 'default',
                background: isHighlighted ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                border: isHighlighted ? '1px solid rgba(59, 130, 246, 0.3)' : 'none'
            }
        }, [
            isFolder ? React.createElement('span', {
                key: 'folder-icon',
                className: 'tree-icon'
            }, isOpen ? '📂' : '📁') : React.createElement('span', {
                key: 'file-icon',
                className: 'tree-icon'
            }, '📄'),
            
            React.createElement('span', {
                key: 'name',
                className: 'tree-name',
                title: node.fullPath || node.name
            }, node.name),
            
            isFolder && visibleChildren > 0 && React.createElement('span', {
                key: 'badge',
                className: 'tree-badge'
            }, visibleChildren),
            
            !isFolder && repoBase && React.createElement('span', {
                key: 'link',
                className: 'tree-link',
                onClick: (e) => {
                    e.stopPropagation();
                    window.open(`${repoBase}/blob/main/${node.fullPath}`, '_blank');
                },
                title: 'Abrir no GitHub'
            }, '🔗')
        ]),
        
        isOpen && hasChildren && React.createElement('div', {
            key: 'children',
            className: 'tree-node-children'
        }, node.children.map(childNode => 
            React.createElement(TreeNode, {
                key: childNode.id,
                node: childNode,
                repoBase: repoBase,
                level: level + 1,
                searchTerm: searchTerm,
                onNodeClick: onNodeClick,
                highlightNodes: highlightNodes
            })
        ))
    ]);
};

// ==================== FUNÇÕES AUXILIARES ====================
const buildFileTree = (files) => {
    const root = { 
        id: 'root', 
        name: 'Repositório', 
        type: 'folder', 
        children: [],
        fullPath: ''
    };
    const pathMap = { '': root };
    
    const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));
    
    sortedFiles.forEach(file => {
        const parts = file.path.split('/');
        let currentPath = '';
        
        for (let i = 0; i < parts.length - 1; i++) {
            const folderPath = parts.slice(0, i + 1).join('/');
            if (!pathMap[folderPath]) {
                pathMap[folderPath] = {
                    id: folderPath,
                    name: parts[i],
                    type: 'folder',
                    children: [],
                    fullPath: folderPath
                };
                const parentPath = parts.slice(0, i).join('/') || '';
                pathMap[parentPath].children.push(pathMap[folderPath]);
            }
            currentPath = folderPath;
        }
        
        const parentPath = parts.slice(0, -1).join('/') || '';
        const fileNode = {
            id: file.path,
            name: parts[parts.length - 1],
            type: 'file',
            fullPath: file.path,
            size: file.sizeKB || Math.round((file.size || 1024) / 1024),
            language: file.language
        };
        pathMap[parentPath].children.push(fileNode);
    });
    
    const sortTree = (node) => {
        if (node.children) {
            node.children.sort((a, b) => {
                if (a.type === b.type) return a.name.localeCompare(b.name);
                return a.type === 'folder' ? -1 : 1;
            });
            node.children.forEach(sortTree);
        }
        return node;
    };
    
    return sortTree(root);
};

// ==================== ANÁLISE DE DEPENDÊNCIAS ====================
const analyzeDependencies = async (files, owner, repo, branch) => {
    console.log('Iniciando análise de dependências...');
    
    const dependencies = {
        nodes: [],
        edges: [],
        stats: {
            totalFiles: 0,
            analyzedFiles: 0,
            totalDependencies: 0,
            externalDeps: 0,
            internalDeps: 0
        }
    };
    
    // Criar nós para cada arquivo
    files.slice(0, 100).forEach(file => { // Limitar a 100 arquivos para performance
        dependencies.nodes.push({
            id: file.path,
            label: file.path.split('/').pop(),
            path: file.path,
            type: 'file',
            extension: file.extension,
            language: file.language,
            imports: [],
            importedBy: [],
            group: getLanguageGroup(file.extension)
        });
    });
    
    dependencies.stats.totalFiles = dependencies.nodes.length;
    
    // Analisar conteúdo dos arquivos para encontrar imports
    for (let i = 0; i < Math.min(dependencies.nodes.length, 30); i++) { // Limitar análise
        const node = dependencies.nodes[i];
        
        try {
            const contentRes = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/contents/${node.path}?ref=${branch}`,
                { 
                    headers: { 
                        'Accept': 'application/vnd.github.v3.raw',
                        'Authorization': '' // API pública tem limite
                    }
                }
            );
            
            if (!contentRes.ok) continue;
            
            const content = await contentRes.text();
            dependencies.stats.analyzedFiles++;
            
            // Padrões de import (simplificado)
            const importPatterns = [
                /from\s+['"](.+?)['"]/g,        // ES6 import
                /require\s*\(\s*['"](.+?)['"]/g, // CommonJS require
                /import\s+['"](.+?)['"]/g,       // ES6 import side-effect
                /import\s*\(['"](.+?)['"]\)/g    // Dynamic import
            ];
            
            const foundImports = [];
            
            importPatterns.forEach(pattern => {
                let match;
                while ((match = pattern.exec(content)) !== null) {
                    const importPath = match[1];
                    if (importPath) {
                        foundImports.push(importPath);
                        dependencies.stats.totalDependencies++;
                        
                        // Classificar como interno ou externo
                        if (importPath.startsWith('.') || importPath.startsWith('/')) {
                            dependencies.stats.internalDeps++;
                        } else {
                            dependencies.stats.externalDeps++;
                        }
                    }
                }
            });
            
            node.imports = foundImports;
            
            // Encontrar arquivo correspondente para cada import
            foundImports.forEach(importPath => {
                const targetFile = resolveImportPath(importPath, node.path, dependencies.nodes);
                if (targetFile) {
                    dependencies.edges.push({
                        from: node.id,
                        to: targetFile.id,
                        id: `${node.id}->${targetFile.id}`,
                        arrows: 'to',
                        color: { color: '#3b82f6', opacity: 0.6 }
                    });
                    
                    // Adicionar relação importedBy
                    if (!targetFile.importedBy) targetFile.importedBy = [];
                    targetFile.importedBy.push(node.id);
                }
            });
            
        } catch (err) {
            console.warn(`Erro ao analisar ${node.path}:`, err);
        }
    }
    
    console.log('Análise completa:', dependencies.stats);
    return dependencies;
};

const resolveImportPath = (importPath, sourcePath, allNodes) => {
    // Simplificado: tentar encontrar correspondência exata ou parcial
    const sourceDir = sourcePath.substring(0, sourcePath.lastIndexOf('/'));
    
    // Casos comuns
    const possiblePaths = [
        importPath,
        `${importPath}.js`,
        `${importPath}.ts`,
        `${importPath}/index.js`,
        `${importPath}/index.ts`,
        `${sourceDir}/${importPath}`,
        `${sourceDir}/${importPath}.js`,
        `${sourceDir}/${importPath}.ts`
    ];
    
    for (const path of possiblePaths) {
        const exactMatch = allNodes.find(n => n.path === path);
        if (exactMatch) return exactMatch;
        
        const partialMatch = allNodes.find(n => 
            n.path.includes(path.replace('./', '').replace('../', ''))
        );
        if (partialMatch) return partialMatch;
    }
    
    return null;
};

const getLanguageGroup = (extension) => {
    const groups = {
        'js': 1, 'jsx': 1,
        'ts': 2, 'tsx': 2,
        'css': 3, 'scss': 3, 'less': 3,
        'json': 4,
        'md': 5,
        'html': 6,
        'py': 7,
        'java': 8,
        'cpp': 9, 'c': 9,
        'cs': 10
    };
    return groups[extension] || 0;
};

// ==================== COMPONENTE GRÁFICO DE DEPENDÊNCIAS ====================
const DependencyGraph = ({ dependencies, onNodeClick, highlightedNode }) => {
    const graphRef = useRef(null);
    const networkRef = useRef(null);
    
    useEffect(() => {
        if (!graphRef.current || !dependencies || dependencies.nodes.length === 0) return;
        
        // Destruir rede anterior se existir
        if (networkRef.current) {
            networkRef.current.destroy();
        }
        
        // Preparar dados para vis-network
        const nodes = new vis.DataSet(
            dependencies.nodes.map(node => ({
                id: node.id,
                label: node.label.length > 20 ? node.label.substring(0, 20) + '...' : node.label,
                title: `
                    <strong>${node.path}</strong><br/>
                    Tipo: ${node.extension}<br/>
                    Importa: ${node.imports?.length || 0} arquivos<br/>
                    Importado por: ${node.importedBy?.length || 0} arquivos
                `,
                group: node.group,
                color: getNodeColor(node.extension),
                shape: 'box',
                font: { color: '#ffffff', size: 12 },
                margin: 10,
                borderWidth: highlightedNode === node.id ? 3 : 1,
                borderColor: highlightedNode === node.id ? '#f59e0b' : '#475569',
                shadow: highlightedNode === node.id
            }))
        );
        
        const edges = new vis.DataSet(dependencies.edges);
        
        // Criar rede
        const container = graphRef.current;
        const data = { nodes, edges };
        
        const options = {
            nodes: {
                shape: 'box',
                size: 30,
                font: {
                    size: 12,
                    color: '#ffffff',
                    strokeWidth: 0
                },
                borderWidth: 2,
                shadow: true
            },
            edges: {
                arrows: {
                    to: {
                        enabled: true,
                        scaleFactor: 0.5
                    }
                },
                color: {
                    color: '#3b82f6',
                    opacity: 0.6,
                    highlight: '#f59e0b'
                },
                smooth: {
                    type: 'continuous',
                    roundness: 0.5
                },
                width: 1.5,
                hoverWidth: 2.5
            },
            physics: {
                enabled: true,
                stabilization: true,
                barnesHut: {
                    gravitationalConstant: -2000,
                    centralGravity: 0.3,
                    springLength: 150,
                    springConstant: 0.04,
                    damping: 0.09
                }
            },
            interaction: {
                hover: true,
                tooltipDelay: 200,
                hideEdgesOnDrag: true,
                navigationButtons: true,
                keyboard: true
            },
            groups: {
                0: { color: { background: '#6b7280', border: '#4b5563' } },
                1: { color: { background: '#3b82f6', border: '#1d4ed8' } },
                2: { color: { background: '#1d4ed8', border: '#1e40af' } },
                3: { color: { background: '#8b5cf6', border: '#7c3aed' } },
                4: { color: { background: '#f59e0b', border: '#d97706' } },
                5: { color: { background: '#10b981', border: '#059669' } },
                6: { color: { background: '#ef4444', border: '#dc2626' } },
                7: { color: { background: '#3b82f6', border: '#1d4ed8' } },
                8: { color: { background: '#dc2626', border: '#b91c1c' } },
                9: { color: { background: '#059669', border: '#047857' } },
                10: { color: { background: '#4f46e5', border: '#4338ca' } }
            }
        };
        
        networkRef.current = new vis.Network(container, data, options);
        
        // Event listeners
        networkRef.current.on('click', (params) => {
            if (params.nodes.length > 0 && onNodeClick) {
                const nodeId = params.nodes[0];
                const node = dependencies.nodes.find(n => n.id === nodeId);
                if (node) onNodeClick(node);
            }
        });
        
        networkRef.current.on('doubleClick', (params) => {
            if (params.nodes.length > 0) {
                networkRef.current.fit({
                    nodes: [params.nodes[0]],
                    animation: { duration: 500 }
                });
            }
        });
        
        // Layout inicial
        setTimeout(() => {
            networkRef.current.fit({ animation: { duration: 1000 } });
        }, 500);
        
        return () => {
            if (networkRef.current) {
                networkRef.current.destroy();
            }
        };
    }, [dependencies, highlightedNode]);
    
    const getNodeColor = (extension) => {
        const colors = {
            'js': '#3b82f6', 'jsx': '#06b6d4',
            'ts': '#1d4ed8', 'tsx': '#1e40af',
            'css': '#8b5cf6', 'scss': '#7c3aed',
            'json': '#f59e0b',
            'md': '#10b981',
            'html': '#ef4444',
            'py': '#3b82f6',
            'java': '#dc2626',
            'cpp': '#059669', 'c': '#059669',
            'cs': '#4f46e5'
        };
        return colors[extension] || '#6b7280';
    };
    
    return React.createElement('div', {
        id: 'dependencyGraph',
        ref: graphRef,
        style: { width: '100%', height: '100%' }
    });
};

// ==================== COMPONENTE PRINCIPAL APP ====================
function App() {
    const [url, setUrl] = useState('');
    const [files, setFiles] = useState([]);
    const [fileTree, setFileTree] = useState(null);
    const [status, setStatus] = useState('Pronto para analisar');
    const [repoBase, setRepoBase] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [repoInfo, setRepoInfo] = useState(null);
    const [lastUrl, setLastUrl] = useState('');
    const [expandedAll, setExpandedAll] = useState(true);
    
    // Novos estados para dependências
    const [dependencies, setDependencies] = useState(null);
    const [analyzingDeps, setAnalyzingDeps] = useState(false);
    const [activeView, setActiveView] = useState('tree'); // 'tree' ou 'deps'
    const [highlightedNode, setHighlightedNode] = useState(null);
    const [depsStats, setDepsStats] = useState(null);
    
    const analyzeGithub = async (githubUrl = null) => {
        const urlToAnalyze = githubUrl || url;
        if (!urlToAnalyze) {
            setError('Por favor, insira uma URL do GitHub');
            return;
        }
        
        const match = urlToAnalyze.match(/github\.com\/([^/]+)\/([^/]+)/);
        if (!match) {
            setError('URL do GitHub inválida. Formato: https://github.com/usuario/repositorio');
            return;
        }
        
        const [_, owner, repo] = match;
        const currentRepo = `${owner}/${repo}`;
        
        if (lastUrl === currentRepo && files.length > 0) {
            setStatus('Repositório já carregado');
            return;
        }
        
        setLoading(true);
        setStatus('🔍 Conectando ao GitHub...');
        setError(null);
        setLastUrl(currentRepo);
        setSearchTerm('');
        setDependencies(null);
        setActiveView('tree');
        
        try {
            const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
                headers: { 'Accept': 'application/vnd.github.v3+json' }
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
                owner: repoData.owner.login,
                default_branch: repoData.default_branch
            });
            
            const branch = repoData.default_branch || 'main';
            const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
            
            console.log('Buscando dados da API:', apiUrl);
            
            const res = await fetch(apiUrl, {
                headers: { 'Accept': 'application/vnd.github.v3+json' }
            });
            
            if (!res.ok) {
                if (res.status === 404) {
                    throw new Error('Branch principal não encontrada');
                } else if (res.status === 403) {
                    throw new Error('Limite de requisições excedido. Aguarde alguns minutos.');
                }
                throw new Error(`Erro ${res.status}: ${res.statusText}`);
            }
            
            const data = await res.json();
            
            if (!data.tree) {
                throw new Error('Estrutura do repositório não encontrada');
            }
            
            const fileList = data.tree
                .filter(f => f.type === 'blob')
                .map(f => ({
                    ...f,
                    path: f.path,
                    extension: f.path.split('.').pop().toLowerCase(),
                    sizeKB: Math.round((f.size || 1024) / 1024 * 10) / 10,
                    language: getFileLanguage(f.path)
                }))
                .filter(f => {
                    const path = f.path.toLowerCase();
                    return !path.includes('node_modules') && 
                           !path.includes('dist') && 
                           !path.includes('build') &&
                           !path.includes('.git') &&
                           !path.startsWith('.');
                });
            
            if (fileList.length === 0) {
                setError('Nenhum arquivo encontrado no repositório');
                setFiles([]);
                setFileTree(null);
                setStatus('⚠️ Repositório vazio ou sem arquivos visíveis');
                setLoading(false);
                return;
            }
            
            setRepoBase(`https://github.com/${owner}/${repo}`);
            setFiles(fileList);
            
            const tree = buildFileTree(fileList);
            setFileTree(tree);
            
            setStatus(`✅ ${fileList.length} arquivos carregados! Clique em "Analisar Dependências"`);
            setLoading(false);
            
        } catch (err) {
            console.error('Erro:', err);
            setError(err.message);
            setStatus('❌ Erro na conexão');
            setFiles([]);
            setFileTree(null);
            setLoading(false);
        }
    };
    
    const analyzeDependenciesForRepo = async () => {
        if (!repoInfo || files.length === 0) return;
        
        setAnalyzingDeps(true);
        setStatus('🔍 Analisando dependências...');
        
        try {
            const [owner, repo] = lastUrl.split('/');
            const branch = repoInfo.default_branch || 'main';
            
            const deps = await analyzeDependencies(files, owner, repo, branch);
            setDependencies(deps);
            setDepsStats(deps.stats);
            setActiveView('deps');
            setStatus(`✅ ${deps.stats.analyzedFiles} arquivos analisados, ${deps.stats.totalDependencies} dependências encontradas`);
        } catch (err) {
            console.error('Erro na análise de dependências:', err);
            setError('Erro ao analisar dependências: ' + err.message);
            setStatus('❌ Falha na análise de dependências');
        } finally {
            setAnalyzingDeps(false);
        }
    };
    
    const getFileLanguage = (path) => {
        const ext = path.split('.').pop().toLowerCase();
        const languages = {
            'js': 'JavaScript', 'jsx': 'JavaScript React',
            'ts': 'TypeScript', 'tsx': 'TypeScript React',
            'css': 'CSS', 'scss': 'SCSS', 'less': 'LESS',
            'json': 'JSON',
            'md': 'Markdown',
            'html': 'HTML',
            'py': 'Python',
            'java': 'Java',
            'cpp': 'C++', 'c': 'C',
            'cs': 'C#',
            'php': 'PHP',
            'rb': 'Ruby',
            'go': 'Go',
            'rs': 'Rust'
        };
        return languages[ext] || ext.toUpperCase();
    };
    
    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !loading) {
            analyzeGithub();
        }
    };
    
    const handleFileClick = (node) => {
        if (repoBase && node.type === 'file') {
            window.open(`${repoBase}/blob/main/${node.fullPath}`, '_blank');
        }
    };
    
    const handleGraphNodeClick = (node) => {
        setHighlightedNode(node.id);
        // Scroll para o nó na árvore se estiver visível
        setTimeout(() => {
            const element = document.querySelector(`[data-node-id="${node.id}"]`);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    };
    
    const calculateStats = () => {
        if (!files.length) return null;
        
        const stats = {
            totalFiles: files.length,
            totalSizeKB: files.reduce((sum, f) => sum + (f.sizeKB || 0), 0),
            byExtension: {}
        };
        
        files.forEach(f => {
            const ext = f.extension;
            stats.byExtension[ext] = (stats.byExtension[ext] || 0) + 1;
        });
        
        return stats;
    };
    
    const stats = calculateStats();
    
    const examples = [
        { name: 'React', url: 'https://github.com/facebook/react' },
        { name: 'Vue.js', url: 'https://github.com/vuejs/vue' },
        { name: 'VS Code', url: 'https://github.com/microsoft/vscode' },
        { name: 'Next.js', url: 'https://github.com/vercel/next.js' }
    ];
    
    // Renderizar legenda do gráfico
    const renderGraphLegend = () => {
        const languageGroups = [
            { name: 'JavaScript', color: '#3b82f6', group: 1 },
            { name: 'TypeScript', color: '#1d4ed8', group: 2 },
            { name: 'CSS/SASS', color: '#8b5cf6', group: 3 },
            { name: 'JSON', color: '#f59e0b', group: 4 },
            { name: 'Markdown', color: '#10b981', group: 5 },
            { name: 'HTML', color: '#ef4444', group: 6 }
        ];
        
        return React.createElement('div', { className: 'deps-legend' }, [
            React.createElement('div', {
                key: 'title',
                style: { fontWeight: 'bold', marginBottom: '10px', fontSize: '12px' }
            }, 'Legenda de Cores'),
            ...languageGroups.map(lang => 
                React.createElement('div', { key: lang.name, className: 'deps-legend-item' }, [
                    React.createElement('div', {
                        key: 'color',
                        className: 'deps-legend-color',
                        style: { background: lang.color }
                    }),
                    React.createElement('span', { key: 'name' }, lang.name)
                ])
            )
        ]);
    };
    
    // Renderizar estatísticas de dependências
    const renderDepsStats = () => {
        if (!depsStats) return null;
        
        return React.createElement('div', { className: 'deps-stats' }, [
            React.createElement('div', { key: 'analyzed', className: 'deps-stat' }, [
                React.createElement('div', { key: 'value', className: 'deps-stat-value' }, depsStats.analyzedFiles),
                React.createElement('div', { key: 'label', className: 'deps-stat-label' }, 'Arquivos Analisados')
            ]),
            React.createElement('div', { key: 'deps', className: 'deps-stat' }, [
                React.createElement('div', { key: 'value', className: 'deps-stat-value' }, depsStats.totalDependencies),
                React.createElement('div', { key: 'label', className: 'deps-stat-label' }, 'Dependências Totais')
            ]),
            React.createElement('div', { key: 'internal', className: 'deps-stat' }, [
                React.createElement('div', { key: 'value', className: 'deps-stat-value' }, depsStats.internalDeps),
                React.createElement('div', { key: 'label', className: 'deps-stat-label' }, 'Dependências Internas')
            ])
        ]);
    };
    
    return React.createElement('div', { 
        style: { width: '100%', height: '100%', position: 'relative' } 
    }, [
        // UI Layer
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
                }, 'GitHub Repository Analyzer'),
                React.createElement('p', { 
                    key: 'subtitle',
                    style: { fontSize: '12px', color: '#94a3b8', margin: '0' }
                }, 'Visualize a estrutura e dependências do código')
            ]),
            
            // View Toggle
            files.length > 0 && React.createElement('div', {
                key: 'view-toggle',
                className: 'view-toggle'
            }, [
                React.createElement('button', {
                    key: 'tree-view',
                    className: activeView === 'tree' ? 'active' : '',
                    onClick: () => setActiveView('tree')
                }, '🌳 Visualização em Árvore'),
                React.createElement('button', {
                    key: 'deps-view',
                    className: activeView === 'deps' ? 'active' : '',
                    onClick: () => {
                        if (!dependencies && !analyzingDeps) {
                            analyzeDependenciesForRepo();
                        } else {
                            setActiveView('deps');
                        }
                    },
                    disabled: analyzingDeps
                }, analyzingDeps ? '🔍 Analisando...' : '🔗 Mapa de Dependências')
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
                    disabled: loading || analyzingDeps
                }),
                React.createElement('button', { 
                    key: 'button',
                    onClick: () => analyzeGithub(),
                    disabled: loading || analyzingDeps
                }, loading ? [
                    React.createElement('span', { key: 'spinner', className: 'loading-spinner' }),
                    'ANALISANDO...'
                ] : '🚀 ANALISAR REPOSITÓRIO')
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
                className: 'file-stats'
            }, [
                React.createElement('div', {
                    key: 'name',
                    style: { fontWeight: 'bold', marginBottom: '5px' }
                }, `${repoInfo.owner}/${repoInfo.name}`),
                repoInfo.description && React.createElement('div', {
                    key: 'desc',
                    style: { fontSize: '11px', marginBottom: '5px', color: '#cbd5e1' }
                }, repoInfo.description),
                React.createElement('div', {
                    key: 'stats',
                    className: 'stats-grid'
                }, [
                    React.createElement('div', { key: 'lang', className: 'stat-item' }, [
                        React.createElement('span', { key: 'label' }, 'Linguagem:'),
                        React.createElement('span', { key: 'value', className: 'stat-value' }, repoInfo.language || 'Várias')
                    ]),
                    React.createElement('div', { key: 'stars', className: 'stat-item' }, [
                        React.createElement('span', { key: 'label' }, '⭐ Stars:'),
                        React.createElement('span', { key: 'value', className: 'stat-value' }, repoInfo.stars)
                    ]),
                    React.createElement('div', { key: 'forks', className: 'stat-item' }, [
                        React.createElement('span', { key: 'label' }, '🍴 Forks:'),
                        React.createElement('span', { key: 'value', className: 'stat-value' }, repoInfo.forks)
                    ]),
                    React.createElement('div', { key: 'files', className: 'stat-item' }, [
                        React.createElement('span', { key: 'label' }, '📁 Arquivos:'),
                        React.createElement('span', { key: 'value', className: 'stat-value' }, files.length)
                    ])
                ])
            ]),
            
            dependencies && renderDepsStats(),
            
            files.length === 0 && React.createElement('div', {
                key: 'examples',
                style: { marginTop: '15px' }
            }, [
                React.createElement('p', {
                    key: 'label',
                    style: { fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }
                }, 'Experimente com:'),
                React.createElement('div', {
                    key: 'buttons',
                    style: { display: 'flex', flexWrap: 'wrap', gap: '6px' }
                }, examples.map((example, i) =>
                    React.createElement('button', {
                        key: `example-${i}`,
                        style: {
                            padding: '6px 10px',
                            background: 'rgba(30, 41, 59, 0.8)',
                            color: '#cbd5e1',
                            border: '1px solid #475569',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            transition: 'all 0.2s'
                        },
                        onMouseEnter: (e) => {
                            e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)';
                            e.currentTarget.style.borderColor = '#3b82f6';
                        },
                        onMouseLeave: (e) => {
                            e.currentTarget.style.background = 'rgba(30, 41, 59, 0.8)';
                            e.currentTarget.style.borderColor = '#475569';
                        },
                        onClick: () => {
                            setUrl(example.url);
                            setTimeout(() => analyzeGithub(example.url), 100);
                        }
                    }, example.name)
                ))
            ])
        ]),
        
        // Visualização em Árvore
        fileTree && React.createElement('div', {
            key: 'tree-container',
            className: 'tree-container',
            style: { display: activeView === 'tree' ? 'block' : 'none' }
        }, [
            React.createElement('div', {
                key: 'tree-view',
                className: 'tree-view'
            }, [
                React.createElement('div', {
                    key: 'controls',
                    className: 'tree-controls'
                }, [
                    React.createElement('input', {
                        key: 'search',
                        type: 'text',
                        className: 'tree-search',
                        placeholder: '🔍 Buscar arquivos ou pastas...',
                        value: searchTerm,
                        onChange: e => setSearchTerm(e.target.value)
                    }),
                    React.createElement('button', {
                        key: 'expand',
                        onClick: () => setExpandedAll(!expandedAll)
                    }, expandedAll ? 'Recolher Tudo' : 'Expandir Tudo'),
                    React.createElement('button', {
                        key: 'deps-btn',
                        onClick: analyzeDependenciesForRepo,
                        disabled: analyzingDeps
                    }, analyzingDeps ? '🔍 Analisando...' : '🔗 Ver Dependências')
                ]),
                
                React.createElement('div', {
                    key: 'tree-content',
                    style: { maxHeight: 'calc(100vh - 200px)', overflow: 'auto' }
                }, [
                    React.createElement(TreeNode, {
                        key: 'tree-root',
                        node: fileTree,
                        repoBase: repoBase,
                        searchTerm: searchTerm,
                        onNodeClick: handleFileClick,
                        highlightNodes: highlightedNode ? [highlightedNode] : []
                    })
                ])
            ])
        ]),
        
        // Visualização de Dependências
        React.createElement('div', {
            key: 'deps-container',
            className: `dependencies-container ${activeView === 'deps' ? 'active' : ''}`
        }, [
            analyzingDeps ? React.createElement('div', {
                key: 'loading',
                className: 'deps-loading'
            }, [
                React.createElement('div', {
                    key: 'spinner',
                    className: 'deps-loading-spinner'
                }),
                React.createElement('div', { key: 'text' }, 'Analisando dependências...'),
                React.createElement('div', { 
                    key: 'subtext',
                    style: { fontSize: '12px', marginTop: '10px', color: '#64748b' }
                }, 'Isso pode levar alguns minutos dependendo do tamanho do repositório')
            ]) : dependencies ? [
                React.createElement('div', {
                    key: 'controls',
                    className: 'deps-controls'
                }, [
                    React.createElement('button', {
                        key: 'back',
                        onClick: () => setActiveView('tree')
                    }, '← Voltar para Árvore'),
                    React.createElement('button', {
                        key: 'refresh',
                        onClick: analyzeDependenciesForRepo
                    }, '🔄 Reanalisar'),
                    React.createElement('div', {
                        key: 'info',
                        className: 'deps-info'
                    }, [
                        React.createElement('span', { key: 'nodes' }, `📦 ${dependencies.nodes.length} arquivos`),
                        React.createElement('span', { key: 'edges' }, `🔗 ${dependencies.edges.length} conexões`),
                        React.createElement('span', { key: 'stats' }, `📊 ${depsStats.analyzedFiles} analisados`)
                    ])
                ]),
                
                React.createElement(DependencyGraph, {
                    key: 'graph',
                    dependencies: dependencies,
                    onNodeClick: handleGraphNodeClick,
                    highlightedNode: highlightedNode
                }),
                
                renderGraphLegend()
            ] : React.createElement('div', {
                key: 'empty',
                className: 'deps-loading'
            }, [
                React.createElement('div', { 
                    key: 'icon',
                    style: { fontSize: '48px', marginBottom: '15px', opacity: 0.5 }
                }, '🔗'),
                React.createElement('div', { key: 'text' }, 'Nenhuma análise de dependências disponível'),
                React.createElement('button', {
                    key: 'analyze-btn',
                    onClick: analyzeDependenciesForRepo,
                    disabled: analyzingDeps || files.length === 0,
                    style: {
                        padding: '10px 20px',
                        background: '#3b82f6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        marginTop: '15px',
                        fontSize: '14px'
                    }
                }, analyzingDeps ? 'Analisando...' : '🔍 Analisar Dependências')
            ])
        ])
    ]);
}

// Inicializar aplicação
document.addEventListener('DOMContentLoaded', () => {
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
    }
});