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

precision highp float;

attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;

uniform mat4 world;
uniform mat4 view;
uniform mat4 worldViewProjection;
uniform float meanRadius;
uniform float deltaRadius;
uniform float thicknessMultiplier;

varying vec3 vPositionW;
varying vec3 vNormalW;
varying vec3 vPosition;
varying vec2 vUV;

#include "../utils/pi.glsl";

void main() {
    vec4 outPosition = worldViewProjection * vec4(position, 1.0);
    gl_Position = outPosition;

    vPositionW = vec3(world * vec4(position, 1.0));
    vNormalW = vec3(world * vec4(normal, 0.0));
    vPosition = position;

    vUV = uv;

    // we then repeat the texture around the circle
    vUV.x *= 2.0 * PI * meanRadius / deltaRadius;

    // if we are on the interior or exterior of the ring, we account for the vertical stretch
    if(abs(normal.y) < 0.02) {
        vUV.y *= thicknessMultiplier;
    }
}