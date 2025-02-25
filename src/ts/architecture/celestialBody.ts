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

import { OrbitalObject, OrbitalObjectModel } from "./orbitalObject";
import { CanHaveRings, CanHaveRingsModel } from "./canHaveRings";
import { Targetable } from "./targetable";

/**
 * Describes all celestial bodies (a combination of OrbitalObject, CanHaveRings)
 */
export interface CelestialBody extends OrbitalObject, CanHaveRings, Targetable {
    /**
     * The underlying model describing the data of the celestial body
     */
    readonly model: CelestialBodyModel;

    /**
     * Returns the radius of the celestial body
     */
    getRadius(): number;
}

/**
 * Describes the model of a celestial body
 */
export type CelestialBodyModel = OrbitalObjectModel &
    CanHaveRingsModel & {
        /**
         * The radius of the celestial body
         */
        readonly radius: number;
    };
