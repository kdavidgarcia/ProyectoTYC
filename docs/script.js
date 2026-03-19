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
        <input id="lambda" type="number" min="0" step="any" placeholder="Lambda (llegadas)">
        <input id="mu" type="number" min="0" step="any" placeholder="Mu (servicio)">
        <input id="Cs" type="number" min="0" step="any" placeholder="Costo servicio">
        <input id="Cw" type="number" min="0" step="any" placeholder="Costo espera">
    `;

    if (modelo === "mms") {
        html += `<input id="s_max" type="number" min="1" step="1" placeholder="Numero de servidores">`;
    }

    if (modelo === "mm1k") {
        html += `<input id="K" type="number" min="1" step="1" placeholder="Capacidad K">`;
    }

    document.getElementById("formulario").innerHTML = html;
}

async function calcular() {
    const modelo = document.getElementById("modelo").value;

    const data = {
        modelo,
        lambda: document.getElementById("lambda").value,
        mu: document.getElementById("mu").value,
        Cs: document.getElementById("Cs").value,
        Cw: document.getElementById("Cw").value
    };

    if (modelo === "mms") {
        data.s_max = document.getElementById("s_max")?.value;
    }

    if (modelo === "mm1k") {
        data.K = document.getElementById("K")?.value;
    }

    if (!data.modelo || !data.lambda || !data.mu || !data.Cs || !data.Cw) {
        mostrarMensaje("Completa todos los campos.", true);
        return;
    }

    if (modelo === "mms" && !data.s_max) {
        mostrarMensaje("Ingresa el numero de servidores para M/M/s.", true);
        return;
    }

    if (modelo === "mm1k" && !data.K) {
        mostrarMensaje("Ingresa la capacidad K para M/M/1/K.", true);
        return;
    }

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
    }
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

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.table_to_sheet(tabla);
    XLSX.utils.book_append_sheet(wb, ws, "Resultados");
    XLSX.writeFile(wb, "resultados_teoria_colas.xlsx");
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
    estado.textContent = texto;
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

