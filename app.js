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

let izbori2025 = null;

promises.push(d3.json("hrvatska.topo.json"));
promises.push(d3.csv("stanovnistvo_povrsina.csv"));
promises.push(d3.json("izbori2020.json"));
promises.push(d3.csv("jls.csv"));
promises.push(d3.json("combined.json"));

//fetch all files:
Promise.all(promises).then(function (data) {
  croatia = data[0];
  populationData = data[1];
  let electionDataRaw = data[2];
  jlsData = data[3];
  izbori2025 = data[4];

  // console.log(electionDataRaw);
  // console.log(izbori2025);

  votingData = izbori2025.map((d) => {
    return {
      zupNaziv: d.zupNaziv,
      gropNaziv: d.gropNaziv,
      count: d.lista.reduce(
        (accumulator, currentValue) =>
          accumulator.glasova + currentValue.glasova
      ),
      primorac: d.lista.find((d) => d.jedinstvenaSifra == 2).glasova,
      milanovic: d.lista.find((d) => d.jedinstvenaSifra == 1).glasova,
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

  let populationMax = d3.max(populationData, (d) => +d.Population);
  radiusScale = d3.scaleSqrt().domain([0, populationMax]).range([1, 25]);

  municipalities = getMunicipalityData(topoData);

  console.log(municipalities);

  let opcineSelection = renderGeography(topoData, municipalities);

  transformToScatter(opcineSelection);
}

function transformToScatter(selection) {
  selection
    .transition()
    .delay((d) => d.rank * 2)
    .duration(4000)
    .attrTween("d", function (d, i) {
      return flubber.toCircle(
        path(d),
        d.properties.centroid[0],
        d.properties.centroid[1],
        d.properties.radius,
        {
          maxSegmentLength: 2,
        }
      );
    });
  // .on("end", (transition, d) => {
  // console.log(transition, d);
  // d3.select(`#path-${d}`).lower();
  // d3.select(`#circle-${d}`).attr("opacity", 1);
  // })
  // .remove();
}

// helper functions:
function renderGeography(topoData, municipalities) {
  // the div where svg needs to be added is called "map" (id), gett full width and height of the div

  const svg = d3
    .select("#map")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  let opcineSelection = svg
    .append("g")
    .selectAll("path")
    .data(municipalities)
    .enter()
    .append("path")
    .attr("fill", (county) => {
      if (
        !county.properties.votes.primorac ||
        !county.properties.votes.milanovic
      ) {
        return "lightgrey";
      } else if (
        county.properties.votes.primorac > county.properties.votes.milanovic
      ) {
        return color(
          county.properties.votes.primorac / county.properties.votes.count
        );
      } else {
        return color(
          -county.properties.votes.milanovic / county.properties.votes.count
        );
      }
    })
    .attr("stroke", "white")
    .attr("d", path);

  opcineSelection.append("title").text((d) => {
    if (d.properties.votes == null) return "";
    else {
      return [
        d.properties.name,
        `${d3.format(".1%")(
          d.properties.votes.milanovic / d.properties.votes.count
        )} milanovic`,
        `${d3.format(".1%")(
          d.properties.votes.primorac / d.properties.votes.count
        )} primorac`,
      ].join("\n");
    }
  });

  return opcineSelection;
}

function getMunicipalityData(topoData) {
  let retval = topoData.features
    .map((municipality) => {
      let population = populationData.find(
        (d) =>
          d.Name.toUpperCase() == municipality.properties.NAME_2.toUpperCase()
      );

      // if (!population) {
      //   console.log(municipality.properties.NAME_2);
      // }

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

      if (!votingDatum) {
        console.log(`Missing match: ${name}`);
        console.log(municipality.properties);
      }

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
          radius: radiusScale(population.population),
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

  return retval;
}
