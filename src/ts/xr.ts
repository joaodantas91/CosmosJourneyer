//  This file is part of Cosmos Journeyer
//
//  Copyright (C) 2024 Barthélemy Paléologue <barth.paleologue@cosmosjourneyer.com>
//
//  This program is free software: you can redistribute it and/or modify
//  it under the terms of the GNU Affero General Public License as published by
//  the Free Software Foundation, either version 3 of the License, or
//  (at your option) any later version.
//
//  This program is distributed in the hope that it will be useful,
//  but WITHOUT ANY WARRANTY; without even the implied warranty of
//  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//  GNU Affero General Public License for more details.
//
//  You should have received a copy of the GNU Affero General Public License
//  along with this program.  If not, see <https://www.gnu.org/licenses/>.

import "../styles/index.scss";

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Loading/loadingScreen";
import "@babylonjs/core/Misc/screenshotTools";
import "@babylonjs/core/Rendering/depthRendererSceneComponent";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { Mandelbulb } from "./anomalies/mandelbulb/mandelbulb";
import { MandelbulbPostProcess } from "./anomalies/mandelbulb/mandelbulbPostProcess";
import { Scene } from "@babylonjs/core/scene";
import { JuliaSet } from "./anomalies/julia/juliaSet";
import { JuliaSetPostProcess } from "./anomalies/julia/juliaSetPostProcess";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { ArcRotateCamera, Engine } from "@babylonjs/core";
import { newSeededMandelbulbModel } from "./anomalies/mandelbulb/mandelbulbModel";
import { newSeededJuliaSetModel } from "./anomalies/julia/juliaSetModel";

const canvas = document.getElementById("renderer") as HTMLCanvasElement;
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const engine = new Engine(canvas);
engine.displayLoadingUI();

const scene = new Scene(engine);
scene.clearColor = new Color4(0, 0, 0, 0);

const urlParams = new URLSearchParams(window.location.search);

const camera = new ArcRotateCamera("ArcRotateCamera", 0, 3.14 / 3, 5, Vector3.Zero(), scene);
camera.attachControl(canvas, true);
camera.lowerRadiusLimit = 0.5;
camera.wheelPrecision *= 100;

const depthRenderer = scene.enableDepthRenderer(null, false, true);

function createMandelbulb(): TransformNode {
    const mandelBulbModel = newSeededMandelbulbModel(Math.random() * 100_000, "XR Anomaly", []);
    const mandelbulb = new Mandelbulb(mandelBulbModel, scene);
    mandelbulb.getTransform().scalingDeterminant = 1 / 400e3;

    const mandelbulbPP = new MandelbulbPostProcess(mandelbulb.getTransform(), mandelbulb.getBoundingRadius(), mandelBulbModel, scene, []);
    scene.cameras.forEach((camera) => camera.attachPostProcess(mandelbulbPP));
    scene.onNewCameraAddedObservable.add((camera) => {
        camera.attachPostProcess(mandelbulbPP);
    });

    scene.onBeforeRenderObservable.add(() => {
        const deltaSeconds = engine.getDeltaTime() / 1000;
        mandelbulbPP.update(deltaSeconds);
    });

    return mandelbulb.getTransform();
}

function createJulia(): TransformNode {
    const juliaModel = newSeededJuliaSetModel(Math.random() * 100_000, "XR Anomaly", []);
    const julia = new JuliaSet(juliaModel, scene);
    julia.getTransform().scalingDeterminant = 1 / 400e3;

    const juliaPP = new JuliaSetPostProcess(julia.getTransform(), julia.getBoundingRadius(), juliaModel.accentColor, scene, []);
    scene.cameras.forEach((camera) => camera.attachPostProcess(juliaPP));
    scene.onNewCameraAddedObservable.add((camera) => {
        camera.attachPostProcess(juliaPP);
    });

    scene.onBeforeRenderObservable.add(() => {
        const deltaSeconds = engine.getDeltaTime() / 1000;
        juliaPP.update(deltaSeconds);
    });

    return julia.getTransform();
}

const sceneType = urlParams.get("scene");

if (sceneType === "mandelbulb") {
    createMandelbulb();
} else if (sceneType === "julia") {
    createJulia();
} else {
    createMandelbulb();
}

const xr = await scene.createDefaultXRExperienceAsync();
if (xr.baseExperience) {
    // web xr code goes here
    const xrCamera = xr.baseExperience.camera;
    xrCamera.setTransformationFromNonVRCamera(camera, true);
}

scene.onBeforeCameraRenderObservable.add((camera) => {
    depthRenderer.getDepthMap().activeCamera = camera;
});

scene.executeWhenReady(() => {
    engine.loadingScreen.hideLoadingUI();
    engine.runRenderLoop(() => {
        scene.render();
    });
});

window.addEventListener("resize", () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    engine.resize(true);
});
