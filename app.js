const nodePadding = 0.1;

let croatia = null;
let municipalities = null;
let populationData = null;
let populations = null;
let votingData = null;
let jlsData = null;
let promises = [];
let radiusScale = null;

let width = document.getElementById("map").clientWidth;
let height = document.getElementById("map").clientHeight;
let color = d3.scaleSequential(d3.interpolateRdBu).domain([-1, 1]);

let projection = null;
let path = null;

promises.push(d3.json("hrvatska.topo.json"));
promises.push(d3.csv("stanovnistvo_povrsina.csv"));
promises.push(d3.json("izbori2020.json"));
promises.push(d3.csv("jls.csv"));

//fetch all files:
Promise.all(promises).then(function (data) {
  croatia = data[0];
  populationData = data[1];
  let electionDataRaw = data[2];
  jlsData = data[3];

  votingData = electionDataRaw.map((d) => {
    return {
      zupNaziv: d.zupNaziv,
      gropNaziv: d.gropNaziv,
      count: d.lista.reduce(
        (accumulator, currentValue) =>
          accumulator.glasova + currentValue.glasova
      ),
      kgk: d.lista.find((d) => d.jedinstvenaSifra == 2).glasova,
      zoky: d.lista.find((d) => d.jedinstvenaSifra == 1).glasova,
    };
  });

  populations = new Array();
  croatia.objects.hrvatska.geometries.forEach((opcina) => {
    let opcinaFound = populationData.find(
      (d) => d.Name.toUpperCase() == opcina.properties.NAME_2.toUpperCase()
    );

    populations.push({
      id: opcina.properties.ID_2,
      name: opcina.properties.NAME_2,
      found: opcinaFound ? true : false,
      population: opcinaFound ? +opcinaFound.Population : 0,
    });
  });

  wrangleData();
});

function wrangleData() {
  //extract features (opcine)
  const topoData = topojson.feature(croatia, croatia.objects.hrvatska);
//   console.log(topoData); //556 opcina

  projection = d3
    .geoAlbers()
    .rotate([-15, 0])
    .fitExtent(
      [
        [0, 20],
        [width * 0.9, height * 0.9],
      ],
      topoData
    );
  path = d3.geoPath(projection);

  let populationMax = d3.max(populationData, (d) => d.population);
  radiusScale = d3.scaleSqrt().domain([0, populationMax]).range([0, 25]);

  municipalities = getMunicipalityData(topoData);

  console.log(municipalities);

  renderGeography(topoData, municipalities);
}

function renderGeography(topoData, municipalities) {
  // the div where svg needs to be added is called "map" (id), gett full width and height of the div

  const svg = d3
    .select("#map")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  svg
    .append("g")
    .selectAll("path")
    .data(municipalities)
    .enter()
    .append("path")
    .attr("fill", (county) => {
      if (!county.properties.votes.kgk || !county.properties.votes.zoky) {
        return "white";
      } else if (county.properties.votes.kgk > county.properties.votes.zoky) {
        return color(
          county.properties.votes.kgk / county.properties.votes.count
        );
      } else {
        return color(
          -county.properties.votes.zoky / county.properties.votes.count
        );
      }
    })
    .attr("stroke", "white")
    .attr("d", path)
    .append("title")
    .text((d) => {
      return JSON.stringify(d);
      if (d.properties.votes == null) return "";
      else {
        return [
          d.properties.name,
          `${d3.format(".1%")(
            d.properties.votes.zoky / d.properties.votes.count
          )} Zoky`,
          `${d3.format(".1%")(
            d.properties.votes.kgk / d.properties.votes.count
          )} KGK`,
        ].join(" – ");
      }
    });
}

// helper functions:

function getMunicipalityData(topoData) {
  // first, read the population csv

  //   let retval = null;
  return topoData.features
    .map((municipality) => {
      // const { population } = populations.find(
      //   (p) => p.id === municipality.properties.ID_2
      // );

      let population = populationData.find(
        (d) =>
          d.Name.toUpperCase() == municipality.properties.NAME_2.toUpperCase()
      );

      population = {
        id: municipality.properties.ID_2,
        name: municipality.properties.NAME_2,
        population: population ? +population.Population : 0,
        area: population ? +population.Area : 0,
      };

      const name = `${municipality.properties.NAME_2}`;
      const votingDatum = votingData.find(
        (d) => d.gropNaziv.toUpperCase() == name.toUpperCase()
      );

      const jlsDatum = jlsData.find(
        (d) => d.jls.toUpperCase() == name.toUpperCase()
      );

      return {
        ...municipality,
        properties: {
          name,
          votes: { ...votingDatum },
          jls: { ...jlsDatum },
          population,
          centroid: projection(
            turf.centroid(municipality.geometry).geometry.coordinates
          ),
          radius: radiusScale(population),
        },
      };
    })
    .filter((c) => c.properties.centroid)
    .sort((a, b) =>
      a.properties.centroid[0] < b.properties.centroid[0] ? -1 : 1
    )
    .map((d, i) => {
      let geometry;
      if (d.geometry.type !== "MultiPolygon") {
        geometry = d.geometry;
      } else {
        geometry = {
          type: d.geometry.type,
          coordinates: d.geometry.coordinates
            .sort((a, b) =>
              turf.area(turf.polygon(a)) > turf.area(turf.polygon(b)) ? -1 : 1
            )
            .slice(0, 1),
        };
      }
      return {
        ...d,
        rank: i,
        geometry,
      };
    });
}
