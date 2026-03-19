from flask import Flask, request, jsonify
import math
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # IMPORTANTE para conectar con el frontend

def modelo_mm1(lambda_, mu, Cs, Cw, s_max=1):
    datos = []
    for s in range(1, s_max+1):
        rho = lambda_ / mu
        if rho >= 1:
            datos.append([s, "Inestable", "-", "-", "-", "-", "-", "-", "-", "-"])
        else:
            P0 = 1 - rho
            Lq = rho**2 / (1 - rho)
            L = Lq + rho
            Wq = Lq / lambda_
            W = Wq + 1/mu
            cs = s * Cs
            cw = Lq * Cw
            ct = cs + cw
            datos.append([s, rho, P0, Lq, L, Wq, W, cs, cw, ct])
    return datos

def modelo_mms(lambda_, mu, Cs, Cw, s_max):
    datos = []
    for s in range(1, s_max + 1):
        rho = lambda_ / (s * mu)
        if rho >= 1:
            datos.append([s, "Inestable", "-", "-", "-", "-", "-", "-", "-", "-"])
            continue

        suma = sum((lambda_/mu)**n / math.factorial(n) for n in range(s))
        parte2 = ((lambda_/mu)**s) / (math.factorial(s) * (1 - rho))
        P0 = 1 / (suma + parte2)

        Lq = (P0 * ((lambda_/mu)**s) * rho) / (math.factorial(s) * ((1 - rho)**2))
        L = Lq + lambda_/mu
        Wq = Lq / lambda_
        W = Wq + 1/mu
        cs = s * Cs
        cw = Lq * Cw
        ct = cs + cw

        datos.append([s, rho, P0, Lq, L, Wq, W, cs, cw, ct])

    return datos

def modelo_mm1k(lambda_, mu, K, Cs, Cw):
    datos = []
    rho = lambda_ / mu

    if rho == 1:
        P0 = 1 / (K + 1)
    else:
        P0 = (1 - rho) / (1 - rho**(K+1))

    L = 0
    for n in range(K+1):
        Pn = P0 * rho**n
        L += n * Pn

    Lq = L - (1 - P0)
    W = L / lambda_
    Wq = Lq / lambda_

    cs = Cs
    cw = Cw * Lq
    ct = cs + cw

    datos.append([1, rho, P0, Lq, L, Wq, W, cs, cw, ct])
    return datos

@app.route('/calcular', methods=['POST'])
def calcular():
    data = request.json or {}

    try:
        modelo = data.get("modelo")
        if modelo not in {"mm1", "mms", "mm1k"}:
            return jsonify({"error": "Modelo invalido"}), 400

        lambda_ = float(data.get("lambda"))
        mu = float(data.get("mu"))
        Cs = float(data.get("Cs"))
        Cw = float(data.get("Cw"))

        if lambda_ < 0 or mu <= 0 or Cs < 0 or Cw < 0:
            return jsonify({"error": "Verifica los parametros: mu > 0 y costos no negativos"}), 400

        if modelo == "mm1":
            datos = modelo_mm1(lambda_, mu, Cs, Cw)

        elif modelo == "mms":
            s_max = int(data.get("s_max"))
            if s_max < 1:
                return jsonify({"error": "s_max debe ser mayor o igual a 1"}), 400
            datos = modelo_mms(lambda_, mu, Cs, Cw, s_max)

        else:
            K = int(data.get("K"))
            if K < 1:
                return jsonify({"error": "K debe ser mayor o igual a 1"}), 400
            datos = modelo_mm1k(lambda_, mu, K, Cs, Cw)

        return jsonify({"resultados": datos})

    except (TypeError, ValueError):
        return jsonify({"error": "Entradas invalidas: usa solo numeros"}), 400
    except ZeroDivisionError:
        return jsonify({"error": "No se puede dividir por cero. Verifica mu y lambda"}), 400

if __name__ == '__main__':
    app.run(debug=True)