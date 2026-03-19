from flask import Flask, request, jsonify
import math
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

class ModeloCola:
    """Clase base para modelos de colas"""
    def __init__(self, lambda_, mu, Cs, Cw):
        self.lambda_ = lambda_
        self.mu = mu
        self.Cs = Cs
        self.Cw = Cw

    def calcular_pn(self, P0, rho, max_n=None):
        """Calcula probabilidades Pn hasta que Pn < 1%"""
        probabilidades = [{"n": 0, "Pn": P0, "porcentaje": P0 * 100}]
        n = 1
        while True:
            Pn = P0 * (rho ** n)
            probabilidades.append({"n": n, "Pn": Pn, "porcentaje": Pn * 100})
            if Pn < 0.01:
                break
            n += 1
            if max_n and n > max_n:
                break
        return probabilidades

    def redondear_resultado(self, valor):
        """Redondea a 4 decimales"""
        return round(valor, 4) if isinstance(valor, (int, float)) else valor

class ModeloMM1(ModeloCola):
    """Modelo M/M/1: Una cola, un servidor"""
    def calcular(self):
        datos = []
        rho = self.lambda_ / self.mu

        if rho >= 1:
            return [[1, "Inestable", "-", "-", "-", "-", "-", "-", "-", "-"]]

        P0 = 1 - rho
        Lq = self.redondear_resultado((rho ** 2) / (1 - rho))
        L = self.redondear_resultado(Lq + rho)
        Wq = self.redondear_resultado(Lq / self.lambda_)
        W = self.redondear_resultado(Wq + 1 / self.mu)
        cs = self.redondear_resultado(self.Cs)
        cw = self.redondear_resultado(Lq * self.Cw)
        ct = self.redondear_resultado(cs + cw)

        datos.append([1, self.redondear_resultado(rho), self.redondear_resultado(P0), Lq, L, Wq, W, cs, cw, ct])
        return datos

class ModeloMMs(ModeloCola):
    """Modelo M/M/s: Una cola, múltiples servidores"""
    def __init__(self, lambda_, mu, Cs, Cw, s_max):
        super().__init__(lambda_, mu, Cs, Cw)
        self.s_max = s_max

    def calcular(self):
        datos = []
        for s in range(1, self.s_max + 1):
            rho = self.lambda_ / (s * self.mu)

            if rho >= 1:
                datos.append([s, "Inestable", "-", "-", "-", "-", "-", "-", "-", "-"])
                continue

            a = self.lambda_ / self.mu
            suma = sum((a ** n) / math.factorial(n) for n in range(s))
            parte2 = ((a ** s) / (math.factorial(s) * (1 - rho)))
            P0 = 1 / (suma + parte2)

            Lq = self.redondear_resultado((P0 * (a ** s) * rho) / (math.factorial(s) * ((1 - rho) ** 2)))
            L = self.redondear_resultado(Lq + a)
            Wq = self.redondear_resultado(Lq / self.lambda_)
            W = self.redondear_resultado(Wq + 1 / self.mu)
            cs = self.redondear_resultado(s * self.Cs)
            cw = self.redondear_resultado(Lq * self.Cw)
            ct = self.redondear_resultado(cs + cw)

            datos.append([s, self.redondear_resultado(rho), self.redondear_resultado(P0), Lq, L, Wq, W, cs, cw, ct])

        return datos

class ModeloMM1K(ModeloCola):
    """Modelo M/M/1/K: Una cola, un servidor, capacidad limitada K"""
    def __init__(self, lambda_, mu, K, Cs, Cw):
        super().__init__(lambda_, mu, Cs, Cw)
        self.K = K

    def calcular(self):
        datos = []
        rho = self.lambda_ / self.mu

        if rho == 1:
            P0 = 1 / (self.K + 1)
        else:
            P0 = (1 - rho) / (1 - rho ** (self.K + 1))

        L = 0
        for n in range(self.K + 1):
            Pn = P0 * (rho ** n)
            L += n * Pn

        Lq = self.redondear_resultado(L - (1 - P0))
        W = self.redondear_resultado(L / self.lambda_)
        Wq = self.redondear_resultado(Lq / self.lambda_)

        cs = self.redondear_resultado(self.Cs)
        cw = self.redondear_resultado(self.Cw * Lq)
        ct = self.redondear_resultado(cs + cw)

        datos.append([1, self.redondear_resultado(rho), self.redondear_resultado(P0), Lq, self.redondear_resultado(L), Wq, W, cs, cw, ct])
        return datos

@app.route('/calcular', methods=['POST'])
def calcular():
    data = request.json or {}

    try:
        modelo = data.get("modelo")
        if modelo not in {"mm1", "mms", "mm1k"}:
            return jsonify({"error": "Modelo invalido. Usa: mm1, mms o mm1k"}), 400

        lambda_ = float(data.get("lambda", 0))
        mu = float(data.get("mu", 0))
        if modelo == "mm1":
            Cs = 0.0
            Cw = 0.0
        else:
            Cs = float(data.get("Cs", 0))
            Cw = float(data.get("Cw", 0))

        if lambda_ < 0 or mu <= 0 or Cs < 0 or Cw < 0:
            return jsonify({"error": "Verifica los parametros: mu > 0 y costos no negativos"}), 400

        if modelo == "mm1":
            cola = ModeloMM1(lambda_, mu, Cs, Cw)
            resultados = cola.calcular()

        elif modelo == "mms":
            s_max = int(data.get("s_max", 1))
            if s_max < 1:
                return jsonify({"error": "s_max debe ser mayor o igual a 1"}), 400
            cola = ModeloMMs(lambda_, mu, Cs, Cw, s_max)
            resultados = cola.calcular()

        else:  # mm1k
            K = int(data.get("K", 1))
            if K < 1:
                return jsonify({"error": "K debe ser mayor o igual a 1"}), 400
            cola = ModeloMM1K(lambda_, mu, K, Cs, Cw)
            resultados = cola.calcular()

        return jsonify({"resultados": resultados})

    except (TypeError, ValueError) as e:
        return jsonify({"error": f"Entradas invalidas: usa solo numeros. {str(e)}"}), 400
    except ZeroDivisionError:
        return jsonify({"error": "No se puede dividir por cero. Verifica mu y lambda"}), 400
    except Exception as e:
        return jsonify({"error": f"Error interno: {str(e)}"}), 500

@app.route('/analizar-probabilidades', methods=['POST'])
def analizar_probabilidades():
    """Endpoint adicional para obtener análisis detallado de probabilidades Pn"""
    data = request.json or {}

    try:
        modelo = data.get("modelo")
        lambda_ = float(data.get("lambda", 0))
        mu = float(data.get("mu", 0))
        if modelo == "mm1":
            Cs = 0.0
            Cw = 0.0
        else:
            Cs = float(data.get("Cs", 0))
            Cw = float(data.get("Cw", 0))

        if modelo == "mm1":
            cola = ModeloMM1(lambda_, mu, Cs, Cw)
        elif modelo == "mms":
            s_max = int(data.get("s_max", 1))
            cola = ModeloMMs(lambda_, mu, Cs, Cw, s_max)
        elif modelo == "mm1k":
            K = int(data.get("K", 1))
            cola = ModeloMM1K(lambda_, mu, K, Cs, Cw)
        else:
            return jsonify({"error": "Modelo invalido"}), 400

        rho = lambda_ / mu if modelo == "mm1" else lambda_ / mu
        P0 = 1 - rho if modelo == "mm1" and rho < 1 else None

        if P0 is None:
            return jsonify({"error": "No se puede calcular probabilidades para sistema inestable"}), 400

        probabilidades = cola.calcular_pn(P0, rho)
        return jsonify({"probabilidades": probabilidades})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True)