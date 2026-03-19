let chart = null;
const RENDER_BASE_URL = "https://proyectotyc.onrender.com";
const isLocalHost = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
const API_URL = isLocalHost
    ? "http://127.0.0.1:5000/calcular"
    : `${RENDER_BASE_URL}/calcular`;
const THEME_KEY = "queue_theme";

document.addEventListener("DOMContentLoaded", () => {
    inicializarTema();

    const modelo = document.getElementById("modelo");
    if (modelo) {
        modelo.value = "mm1";
    }
    cambiarFormulario();
    toggleAcciones(false);
});

function inicializarTema() {
    const savedTheme = localStorage.getItem(THEME_KEY) || "light";
    aplicarTema(savedTheme);

    const themeToggle = document.getElementById("themeToggle");
    if (!themeToggle) {
        return;
    }

    themeToggle.addEventListener("click", () => {
        const current = document.body.getAttribute("data-theme") || "light";
        const next = current === "dark" ? "light" : "dark";
        aplicarTema(next);
        localStorage.setItem(THEME_KEY, next);
    });
}

function aplicarTema(theme) {
    const isDark = theme === "dark";
    document.body.setAttribute("data-theme", isDark ? "dark" : "light");

    const themeToggle = document.getElementById("themeToggle");
    if (themeToggle) {
        themeToggle.textContent = isDark ? "☀️ Modo claro" : "🌙 Modo oscuro";
    }
}

function cambiarFormulario() {
    const modelo = document.getElementById("modelo").value;
    let html = `
        <div class="param-group">
            <label for="lambda">λ (Tasa de llegadas):</label>
            <input id="lambda" type="number" min="0" step="any" placeholder="Ej: 5">
        </div>
        <div class="param-group">
            <label for="mu">μ (Tasa de servicio):</label>
            <input id="mu" type="number" min="0" step="any" placeholder="Ej: 8">
        </div>
    `;

    let descripcion = "";

    if (modelo === "mm1") {
        descripcion = "Una cola con un único servidor. λ debe ser menor a μ para estabilidad. Este modelo no solicita costos.";
    } else if (modelo === "mms") {
        descripcion = "Una cola con múltiples servidores en paralelo. Ingresa el número de servidores.";
        html += `
        <div class="param-group">
            <label for="Cs">Costo de servicio (Cs):</label>
            <input id="Cs" type="number" min="0" step="any" placeholder="Ej: 10">
        </div>
        <div class="param-group">
            <label for="Cw">Costo de espera (Cw):</label>
            <input id="Cw" type="number" min="0" step="any" placeholder="Ej: 5">
        </div>
        <div class="param-group">
            <label for="s_max">Número de servidores (s):</label>
            <input id="s_max" type="number" min="1" step="1" placeholder="Ej: 3">
        </div>
        `;
    } else if (modelo === "mm1k") {
        descripcion = "Una cola con un servidor y capacidad máxima limitada (K clientes max).";
        html += `
        <div class="param-group">
            <label for="Cs">Costo de servicio (Cs):</label>
            <input id="Cs" type="number" min="0" step="any" placeholder="Ej: 10">
        </div>
        <div class="param-group">
            <label for="Cw">Costo de espera (Cw):</label>
            <input id="Cw" type="number" min="0" step="any" placeholder="Ej: 5">
        </div>
        <div class="param-group">
            <label for="K">Capacidad máxima (K):</label>
            <input id="K" type="number" min="1" step="1" placeholder="Ej: 10">
        </div>
        `;
    }

    document.getElementById("formulario").innerHTML = html;
    document.getElementById("modelo-desc").textContent = descripcion;
}

async function calcular() {
    const modelo = document.getElementById("modelo").value;

    if (!modelo) {
        mostrarMensaje("Selecciona un modelo primero.", true);
        return;
    }

    const data = {
        modelo,
        lambda: parseFloat(document.getElementById("lambda")?.value || 0),
        mu: parseFloat(document.getElementById("mu")?.value || 0)
    };

    if (modelo === "mm1") {
        data.Cs = 0;
        data.Cw = 0;
    } else {
        data.Cs = parseFloat(document.getElementById("Cs")?.value || 0);
        data.Cw = parseFloat(document.getElementById("Cw")?.value || 0);
    }

    if (modelo === "mms") {
        data.s_max = parseInt(document.getElementById("s_max")?.value || 1);
    }

    if (modelo === "mm1k") {
        data.K = parseInt(document.getElementById("K")?.value || 1);
    }

    // Validaciones
    if (!data.lambda || !data.mu) {
        mostrarMensaje("Completa λ y μ.", true);
        return;
    }

    if (data.lambda <= 0 || data.mu <= 0) {
        mostrarMensaje("λ y μ deben ser mayores a cero.", true);
        return;
    }

    if (modelo !== "mm1" && (data.Cs < 0 || data.Cw < 0)) {
        mostrarMensaje("Los costos no pueden ser negativos.", true);
        return;
    }

    if (modelo !== "mm1" && (!Number.isFinite(data.Cs) || !Number.isFinite(data.Cw))) {
        mostrarMensaje("Completa Cs y Cw con valores validos.", true);
        return;
    }

    if (modelo === "mms" && (!data.s_max || data.s_max < 1)) {
        mostrarMensaje("Ingresa un número de servidores válido (≥ 1).", true);
        return;
    }

    if (modelo === "mm1k" && (!data.K || data.K < 1)) {
        mostrarMensaje("Ingresa una capacidad K válida (≥ 1).", true);
        return;
    }

    setLoading(true);
    try {
        mostrarMensaje("Calculando...", false);
        const response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || "Error en el servidor");
        }

        const filas = result.resultados || [];
        mostrarTabla(filas);
        graficar(filas);
        toggleAcciones(filas.length > 0);
        mostrarMensaje("Calculo completado.", false);
    } catch (error) {
        toggleAcciones(false);
        mostrarMensaje(`No se pudo calcular: ${error.message}`, true);
    } finally {
        setLoading(false);
    }
}

function setLoading(isLoading) {
    const overlay = document.getElementById("loadingOverlay");
    if (!overlay) {
        return;
    }

    overlay.classList.toggle("active", isLoading);
    overlay.setAttribute("aria-hidden", isLoading ? "false" : "true");
}

function mostrarTabla(datos) {
    const tbody = document.querySelector("#tabla tbody");
    tbody.innerHTML = "";

    datos.forEach((fila) => {
        const tr = document.createElement("tr");
        fila.forEach((col) => {
            const td = document.createElement("td");
            td.textContent = formatearValor(col);
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}

function graficar(datos) {
    const labels = [];
    const costoServicio = [];
    const costoEspera = [];
    const costoTotal = [];

    datos.forEach((fila) => {
        if (fila[1] !== "Inestable") {
            labels.push(`S=${fila[0]}`);
            costoServicio.push(Number(fila[7]));
            costoEspera.push(Number(fila[8]));
            costoTotal.push(Number(fila[9]));
        }
    });

    const ctx = document.getElementById("grafica").getContext("2d");
    if (chart) {
        chart.destroy();
    }

    chart = new Chart(ctx, {
        type: "line",
        data: {
            labels,
            datasets: [
                {
                    label: "Costo Servicio",
                    data: costoServicio,
                    borderColor: "#1f77b4",
                    backgroundColor: "rgba(31,119,180,0.2)",
                    tension: 0.2
                },
                {
                    label: "Costo Espera",
                    data: costoEspera,
                    borderColor: "#ff7f0e",
                    backgroundColor: "rgba(255,127,14,0.2)",
                    tension: 0.2
                },
                {
                    label: "Costo Total",
                    data: costoTotal,
                    borderColor: "#2ca02c",
                    backgroundColor: "rgba(44,160,44,0.2)",
                    tension: 0.2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: "top"
                }
            }
        }
    });
}

function exportarExcel() {
    const tabla = document.getElementById("tabla");
    const tbody = document.querySelector("#tabla tbody");

    if (!tabla || !tbody || tbody.rows.length === 0) {
        mostrarMensaje("No hay datos en la tabla para exportar.", true);
        return;
    }

    const encabezados = Array.from(document.querySelectorAll("#tabla thead th"))
        .map((th) => th.textContent.trim());
    const filas = Array.from(tbody.querySelectorAll("tr")).map((tr) =>
        Array.from(tr.querySelectorAll("td")).map((td) => td.textContent.trim())
    );

    const ws = XLSX.utils.aoa_to_sheet([encabezados, ...filas]);
    const wb = XLSX.utils.book_new();

    const headerStyle = {
        font: { bold: true, color: { rgb: "FFFFFFFF" } },
        fill: { patternType: "solid", fgColor: { rgb: "FF0F172A" } },
        alignment: { horizontal: "center", vertical: "center" },
        border: {
            top: { style: "thin", color: { rgb: "FFCBD5E1" } },
            bottom: { style: "thin", color: { rgb: "FFCBD5E1" } },
            left: { style: "thin", color: { rgb: "FFCBD5E1" } },
            right: { style: "thin", color: { rgb: "FFCBD5E1" } }
        }
    };

    const bodyStyle = {
        alignment: { horizontal: "center", vertical: "center" },
        border: {
            top: { style: "thin", color: { rgb: "FFE2E8F0" } },
            bottom: { style: "thin", color: { rgb: "FFE2E8F0" } },
            left: { style: "thin", color: { rgb: "FFE2E8F0" } },
            right: { style: "thin", color: { rgb: "FFE2E8F0" } }
        }
    };

    const ref = ws["!ref"];
    if (ref) {
        const range = XLSX.utils.decode_range(ref);

        for (let col = range.s.c; col <= range.e.c; col += 1) {
            const headerAddress = XLSX.utils.encode_cell({ r: 0, c: col });
            if (ws[headerAddress]) {
                ws[headerAddress].s = { ...headerStyle };
            }
        }

        for (let row = 1; row <= range.e.r; row += 1) {
            for (let col = range.s.c; col <= range.e.c; col += 1) {
                const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
                if (ws[cellAddress]) {
                    ws[cellAddress].s = { ...bodyStyle };
                }
            }
        }
    }

    ws["!cols"] = encabezados.map(() => ({ wch: 12 }));
    XLSX.utils.book_append_sheet(wb, ws, "Resultados");
    XLSX.writeFile(wb, "resultados_teoria_colas.xlsx", { cellStyles: true, compression: true });
}

function exportarPDF() {
    const canvas = document.getElementById("grafica");

    if (!canvas || !chart) {
        mostrarMensaje("Primero genera una grafica para exportar.", true);
        return;
    }

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("l", "mm", "a4");

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext("2d");

    tempCtx.fillStyle = "#ffffff";
    tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.drawImage(canvas, 0, 0);

    const imgData = tempCanvas.toDataURL("image/png");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;

    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2 - 8;

    const ratio = Math.min(usableWidth / tempCanvas.width, usableHeight / tempCanvas.height);
    const imgWidth = tempCanvas.width * ratio;
    const imgHeight = tempCanvas.height * ratio;

    const x = (pageWidth - imgWidth) / 2;
    const y = 14;

    pdf.text("Grafica de costos", margin, 8);
    pdf.addImage(imgData, "PNG", x, y, imgWidth, imgHeight);
    pdf.save("grafica_teoria_colas.pdf");
}

function exportarGrafica() {
    const canvas = document.getElementById("grafica");

    if (!canvas || !chart) {
        mostrarMensaje("Primero genera una grafica para exportar.", true);
        return;
    }

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png", 1.0);
    link.download = "grafica_teoria_colas.png";
    link.click();
}

function toggleAcciones(enabled) {
    const buttons = document.querySelectorAll(".acciones button");
    buttons.forEach((btn) => {
        btn.disabled = !enabled;
    });
}

function mostrarMensaje(texto, isError) {
    const estado = document.getElementById("estado");
    if (!estado) {
        return;
    }

    const mensajeFinal = !isError && /completado/i.test(texto)
        ? `✅ ${texto}`
        : texto;

    estado.textContent = mensajeFinal;
    estado.className = isError ? "estado error" : "estado ok";
}

function formatearValor(valor) {
    if (typeof valor !== "number") {
        return valor;
    }
    if (Number.isInteger(valor)) {
        return String(valor);
    }
    return valor.toFixed(4);
}

