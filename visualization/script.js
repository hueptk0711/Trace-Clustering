// Cache for force simulation and process graphs
const simulationCache = new Map();
const processGraphCache = new Map();

d3.json("DomesticDeclarations.json").then(data => {
    const clusters = data.clusters;
    const legend = data.legend;
    const clusterInfo = data.cluster_info;

    // Color scale (ColorBrewer 12 qualitative colors)
    const colorScale = d3.scaleOrdinal()
        .domain(Object.keys(legend))
        .range(["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", 
                "#e377c2", "#7f7f7f", "#bcbd22", "#17becf", "#aec7e8", "#ffbb78"]);

    // Cluster Info (V) - Initialize with display mode and filters
    const infoDiv = d3.select("#cluster-info");

    // Populate cluster filters
    const clusterFilter = infoDiv.select("#cluster-filter");
    const clusterFilter2 = infoDiv.select("#cluster-filter-2");
    const displayMode = infoDiv.select("#display-mode");

    function populateClusters() {
        clusterFilter.selectAll("option.cluster-option")
            .data(Object.keys(clusters))
            .enter()
            .append("option")
            .attr("class", "cluster-option")
            .attr("value", d => d)
            .text(d => `Cluster ${d} (Size: ${clusters[d].size})`);

        clusterFilter2.selectAll("option.cluster-option")
            .data(Object.keys(clusters))
            .enter()
            .append("option")
            .attr("class", "cluster-option")
            .attr("value", d => d)
            .text(d => `Cluster ${d} (Size: ${clusters[d].size})`);
    }

    populateClusters();

    // Cluster Overview (I)
    const overviewSvg = d3.select("#cluster-overview")
        .append("svg")
        .attr("width", "100%")
        .attr("height", "100%");

    let overviewBounds = overviewSvg.node().getBoundingClientRect();
    let xScale, yScale;

    function updateVisualization(selectedCluster = "all") {
        overviewBounds = overviewSvg.node().getBoundingClientRect();

        // Filter clusters based on selection
        const filteredClusters = selectedCluster === "all" 
            ? Object.entries(clusters).filter(([label]) => label !== "-1")
            : Object.entries(clusters).filter(([label]) => label === selectedCluster && label !== "-1");

        // Prepare data for force simulation
        xScale = d3.scaleLinear()
            .domain(d3.extent(filteredClusters.flatMap(([_, c]) => c.coords.map(d => d[0]))))
            .range([40, overviewBounds.width - 40]);
        yScale = d3.scaleLinear()
            .domain(d3.extent(filteredClusters.flatMap(([_, c]) => c.coords.map(d => d[1]))))
            .range([40, overviewBounds.height - 40]);

        const nodes = filteredClusters.map(([label, cluster]) => ({
            label: label,
            cluster: cluster,
            x: xScale(cluster.coords[0][0]),
            y: yScale(cluster.coords[0][1]),
            radius: Math.max(15, Math.log(cluster.size + 1) * 3) + 10
        }));

        // Check cache for simulation
        const cacheKey = JSON.stringify(nodes.map(n => ({ label: n.label, x: n.x, y: n.y })));
        let simulationNodes = simulationCache.get(cacheKey);

        if (!simulationNodes) {
            const simulation = d3.forceSimulation(nodes)
                .force("collide", d3.forceCollide().radius(d => d.radius).strength(0.7))
                .force("center", d3.forceCenter(overviewBounds.width / 2, overviewBounds.height / 2))
                .force("x", d3.forceX().x(d => Math.max(d.radius + 20, Math.min(overviewBounds.width - d.radius - 20, d.x))))
                .force("y", d3.forceY().y(d => Math.max(d.radius + 20, Math.min(overviewBounds.height - d.radius - 20, d.y))))
                .stop();

            // Run simulation with fewer iterations
            for (let i = 0; i < 100; i++) simulation.tick();
            simulationCache.set(cacheKey, nodes);
            simulationNodes = nodes;
        }

        // Calculate SVG size
        const xExtent = d3.extent(simulationNodes, d => d.x);
        const yExtent = d3.extent(simulationNodes, d => d.y);
        const padding = 40;
        const svgWidth = xExtent[1] - xExtent[0] + 2 * padding;
        const svgHeight = yExtent[1] - yExtent[0] + 2 * padding;

        overviewSvg
            .attr("width", svgWidth)
            .attr("height", svgHeight);

        // Clear previous glyphs
        overviewSvg.selectAll(".cluster-glyph").remove();

        // Draw clusters
        simulationNodes.forEach(node => {
            const { label, cluster, x, y } = node;

            const glyph = overviewSvg.append("g")
                .attr("class", "cluster-glyph")
                .attr("data-label", label)
                .attr("transform", `translate(${x - (xExtent[0] - padding)}, ${y - (yExtent[0] - padding)})`)
                .on("click", () => {
                    d3.selectAll(".cluster-glyph").classed("selected", false);
                    glyph.classed("selected", true);
                    showDetails(label);
                });

            // Pie chart for activity distribution
            const pie = d3.pie().value(d => d[1]);
            const arc = d3.arc().innerRadius(0).outerRadius(15);
            const pieData = Object.entries(cluster.activity_distribution);
            glyph.selectAll(".arc")
                .data(pie(pieData))
                .enter()
                .append("path")
                .attr("d", arc)
                .attr("fill", d => colorScale(d.data[0]));

            // Size indicator
            glyph.append("circle")
                .attr("r", Math.log(cluster.size + 1) * 3)
                .attr("fill", "none")
                .attr("stroke", "black");

            // Bounding box for selected cluster
            glyph.append("rect")
                .attr("x", -25)
                .attr("y", -25)
                .attr("width", 50)
                .attr("height", 50)
                .attr("fill", "none")
                .attr("stroke", "none");
        });
    }

    // Handle display mode change
    displayMode.on("change", function() {
        const mode = d3.select(this).property("value");
        if (mode === "single") {
            d3.select("#second-cluster-filter").style("display", "none");
            d3.select("#legend").selectAll("*").remove();
            updateLegend();
            updateVisualization(clusterFilter.property("value"));
        } else {
            d3.select("#second-cluster-filter").style("display", "block");
            const secondCluster = clusterFilter2.property("value");
            if (secondCluster !== "none") {
                showSecondClusterProcessGraph(secondCluster);
            }
        }
    });

    // Handle cluster filter change
    clusterFilter.on("change", function() {
        const selectedCluster = d3.select(this).property("value");
        updateVisualization(selectedCluster);
        if (selectedCluster !== "all") {
            showDetails(selectedCluster);
        } else {
            d3.select("#process-graph").selectAll("*").remove();
            d3.select("#cluster-detail").selectAll("*").remove();
        }
    });

    // Handle second cluster filter change
    clusterFilter2.on("change", function() {
        const secondCluster = d3.select(this).property("value");
        if (secondCluster !== "none" && displayMode.property("value") === "dual") {
            showSecondClusterProcessGraph(secondCluster);
            showDetails(clusterFilter.property("value"));
        }
    });

    // Resize handler
    window.addEventListener("resize", () => updateVisualization(clusterFilter.property("value")));

    // Legend (IV) with search for single mode
    function getTextWidth(text, font = "14px Arial") {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        context.font = font;
        return context.measureText(text).width;
    }

    const legendLabels = Object.keys(legend);
    const longestLabelWidth = Math.max(...legendLabels.map(label => getTextWidth(label)));
    const legendWidth = longestLabelWidth + 40 + 20 + 20;
    document.getElementById("legend").style.minWidth = `${legendWidth}px`;

    const legendSvg = d3.select("#legend")
        .append("svg")
        .attr("width", "100%");

    // Add search input for single mode
    d3.select("#legend")
        .insert("input", ":first-child")
        .attr("id", "search-input")
        .attr("type", "text")
        .attr("placeholder", "Search activities...")
        .on("input", function() {
            if (displayMode.property("value") === "single") {
                const searchTerm = this.value.toLowerCase();
                updateLegend(searchTerm);
            }
        });

    function updateLegend(searchTerm = "") {
        if (displayMode.property("value") !== "single") return;

        const filteredLegend = Object.entries(legend).filter(([activity]) => 
            activity.toLowerCase().includes(searchTerm)
        );

        legendSvg.selectAll(".legend-item").remove();
        legendSvg.attr("height", filteredLegend.length * 25 + 50);

        legendSvg.selectAll(".legend-item")
            .data(filteredLegend)
            .enter()
            .append("g")
            .attr("class", "legend-item")
            .attr("transform", (d, i) => `translate(10, ${i * 25 + 25})`)
            .each(function(d) {
                d3.select(this).append("rect")
                    .attr("width", 20)
                    .attr("height", 20)
                    .attr("fill", colorScale(d[0]));
                d3.select(this).append("text")
                    .attr("x", 30)
                    .attr("y", 15)
                    .text(d[0]);
            });
    }

    updateLegend();

    // Topological sort for process graph
    function topologicalSort(nodes, edges) {
        const adjList = new Map();
        const inDegree = new Map();
        nodes.forEach(node => {
            adjList.set(node.id, []);
            inDegree.set(node.id, 0);
        });

        edges.forEach(edge => {
            adjList.get(edge.from).push(edge.to);
            inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
        });

        const queue = [];
        nodes.forEach(node => {
            if (inDegree.get(node.id) === 0) queue.push(node.id);
        });

        const sorted = [];
        while (queue.length > 0) {
            const nodeId = queue.shift();
            sorted.push(nodeId);
            adjList.get(nodeId).forEach(neighbor => {
                inDegree.set(neighbor, inDegree.get(neighbor) - 1);
                if (inDegree.get(neighbor) === 0) queue.push(neighbor);
            });
        }

        nodes.forEach(node => {
            if (!sorted.includes(node.id)) sorted.push(node.id);
        });

        return sorted.map(nodeId => nodes.find(node => node.id === nodeId));
    }

    // Show process graph for second cluster in legend
    function showSecondClusterProcessGraph(clusterLabel) {
        if (displayMode.property("value") !== "dual") return;

        const cluster = clusters[clusterLabel];
        if (!cluster) {
            console.error(`Cluster ${clusterLabel} not found!`);
            return;
        }

        d3.select("#legend").selectAll("*").remove();
        const graphSvg = d3.select("#legend")
            .append("svg")
            .attr("width", "100%");

        const graphBounds = graphSvg.node().getBoundingClientRect();
        const nodes = cluster.process_graph.nodes || [];
        const edges = cluster.process_graph.edges || [];

        if (nodes.length === 0 || edges.length === 0) {
            graphSvg
                .attr("height", 50)
                .append("text")
                .attr("x", 10)
                .attr("y", 20)
                .text(`No process graph data for Cluster ${clusterLabel}`);
        } else {
            const sortedNodes = topologicalSort(nodes, edges);
            const nodeHeight = 40;
            const margin = 20;
            const nodeSpacing = 100;
            const padding = 20;
            const loopOffset = 50;

            const nodeWidths = sortedNodes.map(node => {
                const textWidth = getTextWidth(node.label, "12px Arial");
                return Math.max(200, textWidth + 60);
            });
            const maxNodeWidth = Math.max(...nodeWidths);
            const effectiveWidth = maxNodeWidth + loopOffset * 2;
            const svgWidth = Math.max(graphBounds.width, effectiveWidth + 2 * padding);
            graphSvg.attr("width", svgWidth);

            const nodeMap = new Map();
            sortedNodes.forEach((node, i) => {
                node.x = (svgWidth / 2);
                node.y = margin + i * nodeSpacing;
                node.width = nodeWidths[i];
                nodeMap.set(node.id, node);
            });

            const svgHeight = margin + sortedNodes.length * nodeSpacing + nodeHeight;
            graphSvg.attr("height", svgHeight);

            // Draw links
            const link = graphSvg.append("g")
                .selectAll(".link")
                .data(edges)
                .enter()
                .append("path")
                .attr("class", "link")
                .attr("d", d => {
                    const source = nodeMap.get(d.from);
                    const target = nodeMap.get(d.to);
                    if (!source || !target) return "";

                    if (target.y > source.y) {
                        const startX = source.x;
                        const startY = source.y + nodeHeight;
                        const endX = target.x;
                        const endY = target.y;
                        return `M${startX},${startY} L${endX},${endY}`;
                    } else {
                        const startX = source.x + source.width / 2;
                        const startY = source.y + nodeHeight / 2;
                        const endX = target.x + target.width / 2;
                        const endY = target.y + nodeHeight / 2;
                        const midX = Math.max(startX, endX) + loopOffset;
                        return `M${startX},${startY} 
                                Q${midX},${startY} ${midX},${(startY + endY) / 2}
                                Q${midX},${endY} ${endX},${endY}`;
                    }
                })
                .attr("marker-end", "url(#arrow)")
                .attr("stroke-opacity", 0.7)
                .on("mouseover", function() {
                    d3.select(this).attr("stroke-opacity", 1).attr("stroke-width", 3);
                })
                .on("mouseout", function() {
                    d3.select(this).attr("stroke-opacity", 0.7).attr("stroke-width", 2);
                });

            // Define arrow marker
            graphSvg.append("defs").append("marker")
                .attr("id", "arrow")
                .attr("viewBox", "0 -5 10 10")
                .attr("refX", 5)
                .attr("refY", 0)
                .attr("markerWidth", 6)
                .attr("markerHeight", 6)
                .attr("orient", "auto")
                .append("path")
                .attr("d", "M0,-5L10,0L0,5")
                .attr("fill", "black");

            // Draw nodes
            const node = graphSvg.append("g")
                .selectAll(".node")
                .data(sortedNodes)
                .enter()
                .append("g")
                .attr("transform", d => `translate(${d.x - d.width / 2},${d.y})`)
                .attr("class", "node-group")
                .on("mouseover", function() {
                    d3.select(this).select("rect").attr("fill", "#355f8d");
                })
                .on("mouseout", function() {
                    d3.select(this).select("rect").attr("fill", "#4682B4");
                });

            // Node rectangle
            node.append("rect")
                .attr("class", "node")
                .attr("width", d => d.width)
                .attr("height", nodeHeight)
                .attr("rx", 5)
                .attr("ry", 5);

            // Activity circle
            node.append("circle")
                .attr("class", "activity-circle")
                .attr("cx", d => d.width - 20)
                .attr("cy", nodeHeight / 2)
                .attr("r", 10)
                .attr("fill", d => colorScale(d.label));

            // Node text
            node.append("text")
                .attr("class", "node-text")
                .attr("x", d => d.width / 2 - 15)
                .attr("y", nodeHeight / 2 + 5)
                .text(d => d.label);

            // End symbol
            node.filter(d => d.label === "PAYMENT_HANDLED" || d.label === "Pay invoice")
                .append("rect")
                .attr("class", "end-symbol")
                .attr("x", d => d.width - 20)
                .attr("y", nodeHeight - 15)
                .attr("width", 10)
                .attr("height", 10);

            // Cache the SVG content
            processGraphCache.set(clusterLabel, graphSvg.node().outerHTML);
        }
    }

    // Show details of a selected cluster
    function showDetails(clusterLabel) {
        const cluster = clusters[clusterLabel];
        if (!cluster) {
            console.error(`Cluster ${clusterLabel} not found!`);
            return;
        }

        // Update Cluster Info
        d3.select("#cluster-info")
            .select("#cluster-filter")
            .property("value", clusterLabel);

        // Process Graph (II) - Check cache
        if (processGraphCache.has(clusterLabel)) {
            d3.select("#process-graph").html(processGraphCache.get(clusterLabel));
        } else {
            d3.select("#process-graph").selectAll("*").remove();
            const graphSvg = d3.select("#process-graph")
                .append("svg")
                .attr("width", "100%");

            const graphBounds = graphSvg.node().getBoundingClientRect();
            const nodes = cluster.process_graph.nodes || [];
            const edges = cluster.process_graph.edges || [];

            if (nodes.length === 0 || edges.length === 0) {
                graphSvg
                    .attr("height", 50)
                    .append("text")
                    .attr("x", 10)
                    .attr("y", 20)
                    .text(`No process graph data for Cluster ${clusterLabel}`);
            } else {
                const sortedNodes = topologicalSort(nodes, edges);
                const nodeHeight = 40;
                const margin = 20;
                const nodeSpacing = 100;
                const padding = 20;
                const loopOffset = 50;

                const nodeWidths = sortedNodes.map(node => {
                    const textWidth = getTextWidth(node.label, "12px Arial");
                    return Math.max(200, textWidth + 60);
                });
                const maxNodeWidth = Math.max(...nodeWidths);
                const effectiveWidth = maxNodeWidth + loopOffset * 2;
                const svgWidth = Math.max(graphBounds.width, effectiveWidth + 2 * padding);
                graphSvg.attr("width", svgWidth);

                const nodeMap = new Map();
                sortedNodes.forEach((node, i) => {
                    node.x = (svgWidth / 2);
                    node.y = margin + i * nodeSpacing;
                    node.width = nodeWidths[i];
                    nodeMap.set(node.id, node);
                });

                const svgHeight = margin + sortedNodes.length * nodeSpacing + nodeHeight;
                graphSvg.attr("height", svgHeight);

                // Draw links
                const link = graphSvg.append("g")
                    .selectAll(".link")
                    .data(edges)
                    .enter()
                    .append("path")
                    .attr("class", "link")
                    .attr("d", d => {
                        const source = nodeMap.get(d.from);
                        const target = nodeMap.get(d.to);
                        if (!source || !target) return "";

                        if (target.y > source.y) {
                            const startX = source.x;
                            const startY = source.y + nodeHeight;
                            const endX = target.x;
                            const endY = target.y;
                            return `M${startX},${startY} L${endX},${endY}`;
                        } else {
                            const startX = source.x + source.width / 2;
                            const startY = source.y + nodeHeight / 2;
                            const endX = target.x + target.width / 2;
                            const endY = target.y + nodeHeight / 2;
                            const midX = Math.max(startX, endX) + loopOffset;
                            return `M${startX},${startY} 
                                    Q${midX},${startY} ${midX},${(startY + endY) / 2}
                                    Q${midX},${endY} ${endX},${endY}`;
                        }
                    })
                    .attr("marker-end", "url(#arrow)")
                    .attr("stroke-opacity", 0.7)
                    .on("mouseover", function() {
                        d3.select(this).attr("stroke-opacity", 1).attr("stroke-width", 3);
                    })
                    .on("mouseout", function() {
                        d3.select(this).attr("stroke-opacity", 0.7).attr("stroke-width", 2);
                    });

                // Define arrow marker
                graphSvg.append("defs").append("marker")
                    .attr("id", "arrow")
                    .attr("viewBox", "0 -5 10 10")
                    .attr("refX", 5)
                    .attr("refY", 0)
                    .attr("markerWidth", 6)
                    .attr("markerHeight", 6)
                    .attr("orient", "auto")
                    .append("path")
                    .attr("d", "M0,-5L10,0L0,5")
                    .attr("fill", "black");

                // Draw nodes
                const node = graphSvg.append("g")
                    .selectAll(".node")
                    .data(sortedNodes)
                    .enter()
                    .append("g")
                    .attr("transform", d => `translate(${d.x - d.width / 2},${d.y})`)
                    .attr("class", "node-group")
                    .on("mouseover", function() {
                        d3.select(this).select("rect").attr("fill", "#355f8d");
                    })
                    .on("mouseout", function() {
                        d3.select(this).select("rect").attr("fill", "#4682B4");
                    });

                // Node rectangle
                node.append("rect")
                    .attr("class", "node")
                    .attr("width", d => d.width)
                    .attr("height", nodeHeight)
                    .attr("rx", 5)
                    .attr("ry", 5);

                // Activity circle
                node.append("circle")
                    .attr("class", "activity-circle")
                    .attr("cx", d => d.width - 20)
                    .attr("cy", nodeHeight / 2)
                    .attr("r", 10)
                    .attr("fill", d => colorScale(d.label));

                // Node text
                node.append("text")
                    .attr("class", "node-text")
                    .attr("x", d => d.width / 2 - 15)
                    .attr("y", nodeHeight / 2 + 5)
                    .text(d => d.label);

                // End symbol
                node.filter(d => d.label === "PAYMENT_HANDLED" || d.label === "Pay invoice")
                    .append("rect")
                    .attr("class", "end-symbol")
                    .attr("x", d => d.width - 20)
                    .attr("y", nodeHeight - 15)
                    .attr("width", 10)
                    .attr("height", 10);

                // Cache the SVG content
                processGraphCache.set(clusterLabel, graphSvg.node().outerHTML);
            }
        }

        // Cluster Detail (III)
        d3.select("#cluster-detail").selectAll("*").remove();
        const detailSvg = d3.select("#cluster-detail")
            .append("svg")
            .attr("width", "100%");

        if (displayMode.property("value") === "single") {
            const allActivities = cluster.aligned_traces.flat();
            const uniqueActivities = [...new Set(allActivities)]
                .filter(activity => activity !== "-")
                .sort();

            detailSvg.attr("height", uniqueActivities.length * 25 + 50);

            detailSvg.append("text")
                .attr("x", 10)
                .attr("y", 20)
                .text(`Activities in Cluster ${clusterLabel}`);

            const activityItems = detailSvg.selectAll(".activity-item")
                .data(uniqueActivities)
                .enter()
                .append("g")
                .attr("class", "activity-item")
                .attr("transform", (d, i) => `translate(10, ${i * 25 + 40})`);

            activityItems.append("rect")
                .attr("width", 20)
                .attr("height", 20)
                .attr("fill", d => colorScale(d));

            activityItems.append("text")
                .attr("x", 30)
                .attr("y", 15)
                .text(d => d);
        } else {
            // Dual mode: Show details for both clusters
            const secondClusterLabel = clusterFilter2.property("value");
            const cluster1 = cluster;
            const cluster2 = clusters[secondClusterLabel];

            const activities1 = cluster1.aligned_traces.flat();
            const uniqueActivities1 = [...new Set(activities1)]
                .filter(activity => activity !== "-")
                .sort();
            const activities2 = cluster2 && secondClusterLabel !== "none" ? cluster2.aligned_traces.flat() : [];
            const uniqueActivities2 = cluster2 && secondClusterLabel !== "none" ? [...new Set(activities2)]
                .filter(activity => activity !== "-")
                .sort() : [];

            const totalHeight = (uniqueActivities1.length + uniqueActivities2.length) * 25 + 100;
            detailSvg.attr("height", totalHeight);

            // Cluster 1 details
            detailSvg.append("text")
                .attr("x", 10)
                .attr("y", 20)
                .text(`Activities in Cluster ${clusterLabel}`);

            const activityItems1 = detailSvg.selectAll(".activity-item-1")
                .data(uniqueActivities1)
                .enter()
                .append("g")
                .attr("class", "activity-item")
                .attr("transform", (d, i) => `translate(10, ${i * 25 + 40})`);

            activityItems1.append("rect")
                .attr("width", 20)
                .attr("height", 20)
                .attr("fill", d => colorScale(d));

            activityItems1.append("text")
                .attr("x", 30)
                .attr("y", 15)
                .text(d => d);

            // Cluster 2 details
            if (cluster2 && secondClusterLabel !== "none") {
                detailSvg.append("text")
                    .attr("x", 10)
                    .attr("y", uniqueActivities1.length * 25 + 60)
                    .text(`Activities in Cluster ${secondClusterLabel}`);

                const activityItems2 = detailSvg.selectAll(".activity-item-2")
                    .data(uniqueActivities2)
                    .enter()
                    .append("g")
                    .attr("class", "activity-item")
                    .attr("transform", (d, i) => `translate(10, ${i * 25 + uniqueActivities1.length * 25 + 80})`);

                activityItems2.append("rect")
                    .attr("width", 20)
                    .attr("height", 20)
                    .attr("fill", d => colorScale(d));

                activityItems2.append("text")
                    .attr("x", 30)
                    .attr("y", 15)
                    .text(d => d);
            }
        }
    }
}).catch(error => {
    console.error("Error loading visualization_data.json:", error);
    d3.select("#cluster-info")
        .html("Error: Failed to load visualization data.");
});