const nodePadding = 0.1;

let croatia = null;
let municipalities = null;
let populationData = null;
let populations = null;
let votingData = null;
let jlsData = null;
let promises = [];
let radiusScale = null;

let BACKGROUND = "#f9f9f9";

let width = document.getElementById("map").clientWidth;

// cap with to 1200:
width = width > 1200 ? 1200 : width;

let height = document.getElementById("map").clientHeight;
let color = d3.scaleSequential(d3.interpolateRdBu).domain([-1, 1]);

let projection = null;
let path = null;
let svg = null;

let x,
  y,
  xAxis,
  yAxis = null;

let izbori2025 = null;

const DURATION = 3000;
const DELAY = 6;
// const DURATION = 300;
// const DELAY = 1;

let zoom = null;

const margin = { top: 50, right: 30, bottom: 30, left: 40 };

promises.push(d3.json("hrvatska.topo.json"));
promises.push(d3.csv("stanovnistvo_povrsina.csv"));
// promises.push(d3.json("izbori2020.json"));
promises.push(d3.csv("jls.csv", d3.autoType));
promises.push(d3.json("combined.json"));

//fetch all files:
Promise.all(promises).then(function (data) {
  croatia = data[0];
  populationData = data[1];
  jlsData = data[2];
  izbori2025 = data[3];

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
      // zup_name: opcina.properties.NAME_1,
      found: opcinaFound ? true : false,
      population: opcinaFound ? +opcinaFound.Population : 0,
    });
  });

  wrangleData();
});

// After your data is loaded and municipalities are created, populate the dropdown
function populateDropdown() {
  const select = d3.select("#municipality-select");

  // Sort municipalities by name
  const sortedMunicipalities = municipalities
    .filter((m) => m.properties.jls.obrazovanje) // Only include ones with data
    .sort((a, b) => a.properties.name.localeCompare(b.properties.name, "hr"));

  // Add options to select
  select
    .selectAll("option")
    .data(sortedMunicipalities)
    .enter()
    .append("option")
    .attr("value", (d) => d.properties.name)
    .text((d) => d.properties.name);

  // Initialize chosen
  $(document).ready(function () {
    $("#municipality-select").chosen({
      allow_single_deselect: true,
      no_results_text: "Nije pronađeno: ",
    });

    // Add change handler
    $("#municipality-select").on("change", function (e, params) {
      const selectedName = params.selected;
      const selected = municipalities.find(
        (m) => m.properties.name === selectedName
      );

      if (selected) {
        zoomToMunicipality(selected);
      }
    });
  });
}

function wrangleData() {
  //extract features (opcine)
  const topoData = topojson.feature(croatia, croatia.objects.hrvatska);
  //   console.log(topoData); //556 opcina

  projection = d3
    .geoAlbers()
    .rotate([-15, 0])
    .fitExtent(
      [
        [0, 10],
        [width * 0.9, height * 0.9],
      ],
      topoData
    );
  path = d3.geoPath(projection);

  let populationMax = d3.max(populationData, (d) => +d.Population);
  radiusScale = d3.scaleSqrt().domain([0, populationMax]).range([1.25, 25]);

  municipalities = getMunicipalityData(topoData);

  // console.log(municipalities);
  populateDropdown();

  let opcineSelection = renderGeography();

  transformToCircles(opcineSelection)
    .end()
    .then(() => {
      createScatterPlot();
    });
}

// Add a function to zoom to a specific municipality
function zoomToMunicipality(municipality) {
  // Get the municipality's coordinates in our scale space
  const targetX = x(municipality.properties.jls.obrazovanje);
  const targetY = y(municipality.properties.jls.dohodak);

  const scale = 8; // Adjust this value to control zoom level

  // Calculate the transform accounting for margins
  const transform = d3.zoomIdentity
    .translate(
      margin.left - targetX * scale + (width - margin.left - margin.right) / 2,
      margin.top - targetY * scale + (height - margin.top - margin.bottom) / 2
    )
    .scale(scale);

  // Apply the transform with a smooth transition
  svg
    .transition()
    .duration(750)
    .call(zoom.transform, transform)
    .on("end", () => {
      // Highlight the selected municipality

      svg
        .selectAll("path")
        .filter((d) => d === municipality)
        .transition()
        .duration(250)
        .style("stroke", function () {
          const fill = d3.select(this).attr("fill");
          return fill;
        })
        .transition()
        .duration(250)
        .style("stroke", BACKGROUND)
        .transition()
        .duration(250)
        .style("stroke", function () {
          const fill = d3.select(this).attr("fill");
          return fill;
        })
        .transition()
        .duration(250)
        .style("stroke", BACKGROUND);
    });
}

function createScatterPlot() {
  //y scale: "↑ Prosječni dohodak po stanovniku", field "dohodak"
  //x scale: "Stupanj obrazovanja (VSS, 20-65) →", field "obrazovanje"

  const dohodakExtent = d3.extent(jlsData, (d) => d.dohodak);
  y = d3
    .scaleLinear()
    .domain([dohodakExtent[0] * 0.9, dohodakExtent[1] * 1.1])
    .rangeRound([height - margin.top - margin.bottom, 0])
    .clamp(true);

  const obrazovanjeExtent = d3.extent(jlsData, (d) => d.obrazovanje);
  x = d3
    .scaleLinear()
    .domain([obrazovanjeExtent[0] * 0.95, obrazovanjeExtent[1] * 1.05])
    .rangeRound([0, width - margin.left - margin.right]);

  yAxis = (g) =>
    g
      // .attr("transform", `translate(${margin.left},0)`)
      .attr("class", "y-axis")
      .attr("font-size", 14)
      .call(d3.axisLeft(y).ticks(null, ",d").tickFormat(d3.format(".2s")))
      .call((g) =>
        g
          .append("text")
          .attr("x", -margin.left + 15)
          .attr("y", -10)
          .attr("fill", "currentColor")
          .attr("font-size", 12)
          .attr("text-anchor", "start")
          .text("↑ Prosječni dohodak po stanovniku")
          .append("title")
          .text(
            "Dohodak po stanovniku iz članka 2. točke 2. ove Uredbe izračunava se kao omjer ukupnog iznosa dohotka kojega su tijekom jednoga poreznog razdoblja (kalendarska godina) ostvarili porezni obveznici, fizičke osobe s prebivalištem ili uobičajenim boravištem na području jedinice lokalne, odnosno područne (regionalne) samouprave za koju se vrši izračun, i broja stanovnika koji žive na području te jedinice.\nDohodak iz stavka 1. ovoga članka utvrđuje se prema zakonu kojim se uređuje porez na dohodak, a uključuje dohodak ostvaren od nesamostalnog rada i dohodak ostvaren od samostalne djelatnosti.\nU ukupan iznos dohotka iz stavka 1. ovoga članka uračunava se i dobit koju su ostvarile fizičke osobe od obavljanja samostalne djelatnosti tijekom jednoga poreznog razdoblja (kalendarska godina) na području jedinice lokalne, odnosno područne (regionalne) samouprave za koju se vrši izračun.\nDohotkom od samostalne djelatnosti u smislu stavka 1. ovoga članka smatra se dohodak umanjen za propisana umanjenja i preneseni gubitak, sukladno zakonu kojim se uređuje porez na dohodak.\nDobiti iz stavka 3. ovoga članka smatra se dobit nakon propisanih umanjenja i uvećanja dobiti, sukladno zakonu kojim se uređuje porez na dobit.\nZa izračun pokazatelja iz stavka 1. ovoga članka koriste se podaci Porezne uprave o isplaćenim dohocima i podaci Državnog zavoda za statistiku o broju stanovnika na razini jedinica lokalne, odnosno područne (regionalne) samouprave."
          )
      );

  xAxis = (g) =>
    g
      .attr("transform", `translate(0,${height - margin.bottom - margin.top})`)
      .attr("class", "x-axis")
      .call(d3.axisBottom(x).ticks(width / 80))
      // .call((g) => g.select(".domain").remove())
      .call((g) =>
        g
          .append("text")
          .attr("x", width - margin.right - margin.left)
          .attr("y", -10)
          .attr("fill", "currentColor")
          .attr("font-size", 12)
          .attr("text-anchor", "end")
          .text("Stupanj obrazovanja (VSS, 20-65) →")
          .append("title")
          .text(
            "Stopa obrazovanosti iz članka 2. točke 5. ove Uredbe izračunava se kao udjel stanovništva sa završenim visokim obrazovanjem u ukupnom stanovništvu, u dobi između 20 i 65 godina, na području jedinice lokalne, odnosno područne (regionalne) samouprave.\nZa izračun pokazatelja iz stavka 1. ovoga članka koriste se podaci Državnog zavoda za statistiku o obrazovnoj strukturi stanovništva Republike Hrvatske i broju stanovnika u dobi između 20 i 65 godina na razini jedinica lokalne, odnosno područne (regionalne) samouprave."
          )
      );
  //→

  svg
    .selectAll("path")
    .transition()
    .delay((d) => {
      return d.rank * DELAY;
    })
    .duration(DURATION)
    .attr("transform", function (d) {
      // Find this path’s bounding box
      const b = this.getBBox();
      const currentCenterX = b.x + b.width / 2;
      const currentCenterY = b.y + b.height / 2;

      if (!d.properties.jls.obrazovanje) {
        // console.log(d);
        return null;
      }

      // Compute the offset to your target
      const dx = x(d.properties.jls.obrazovanje) - currentCenterX;
      const dy = y(d.properties.jls.dohodak) - currentCenterY;

      return `translate(${dx}, ${dy})`;
    })
    .attr("opacity", (d) => {
      if (!d.properties.jls.obrazovanje) {
        return 0;
      }
    })
    .end()
    .then(() => {
      //append x axis and y axis
      const mainGroup = svg.select(".mainGroup");
      mainGroup
        .append("g")
        .call(xAxis)
        .attr("opacity", 0)
        .transition()
        .duration(250)
        .attr("opacity", 1);
      mainGroup
        .append("g")
        .call(yAxis)
        .attr("opacity", 0)
        .transition()
        .duration(250)
        .attr("opacity", 1);

      svg
        .append("text")
        .attr("x", width - margin.right - 4)
        .attr("y", height - margin.bottom - 48)
        .attr("fill", "currentColor")
        .attr("font-size", 12)
        .attr("font-family", "sans-serif")
        .attr("text-anchor", "end")
        .text("Autor: Velimir Gašparović")
        .attr("opacity", 0)
        .transition()
        .duration(250)
        .attr("opacity", 0.25);

      d3.select(".dropdown-container")
        .style("left", `${width - margin.right - 338}px`)
        .transition()
        .duration(250)
        .style("opacity", 1);

      svg
        .selectAll("path")
        .on("mouseover", function (event, d) {
          if (!d) return;
          let tooltip = d3.select("#tooltip");
          tooltip.style("display", "block");

          tooltip
            .select("#tooltip-title")
            .text(d.properties.name.toLowerCase());
          tooltip.select("#tooltip-subtitle").text(d.properties.zup_name);
          tooltip
            .select("#candidate1-total")
            .text(d3.format(",")(d.properties.votes.milanovic));
          tooltip
            .select("#candidate1-percent")
            .text(
              d3.format(".2f")(
                (d.properties.votes.milanovic / d.properties.votes.count) * 100
              )
            );

          tooltip
            .select("#candidate2-total")
            .text(d3.format(",")(d.properties.votes.primorac));
          tooltip
            .select("#candidate2-percent")
            .text(
              d3.format(".2f")(
                (d.properties.votes.primorac / d.properties.votes.count) * 100
              )
            );

          let left = event.pageX + 10;
          let top = event.pageY + 10;

          if (left + tooltip.node().getBoundingClientRect().width > width) {
            left = width - tooltip.node().getBoundingClientRect().width - 10;
          }

          if (top + tooltip.node().getBoundingClientRect().height > height) {
            top = height - tooltip.node().getBoundingClientRect().height - 10;
          }

          tooltip.style("left", left + "px");
          tooltip.style("top", top + "px");
        })
        .on("mouseout", function () {
          d3.select("#tooltip").style("display", "none");
        });

      // add zoom to .pathGroup', make sure to make a nice transition of axis
      zoom = d3
        .zoom()
        .scaleExtent([1, 40]) // Min and max zoom scales
        .extent([
          [0, 0],
          [
            width - margin.right - margin.left,
            height - margin.bottom - margin.top,
          ],
        ])
        .on("zoom", zoomed);

      function zoomed(event) {
        const transform = event.transform;

        const pathGroup = svg.select(".pathGroup");

        // Transform the scatter plot
        pathGroup.attr("transform", transform);

        // update circle stroke width inversely with zoom
        pathGroup.selectAll("path").attr("stroke-width", 1 / transform.k);

        svg
          .select(".x-axis")
          .transition()
          .duration(200) // Adjust the duration as needed
          .call(d3.axisBottom(transform.rescaleX(x)));
        // .call((g) => g.select(".domain").remove());

        svg
          .select(".y-axis")
          .transition()
          .duration(200)
          .call(d3.axisLeft(transform.rescaleY(y)));
        // .call((g) => g.select(".domain").remove());
      }

      svg.call(zoom);
    });
}

// helper functions:
function transformToCircles(selection) {
  return (
    selection
      .transition()
      .delay((d) => d.rank * DELAY)
      .duration(DURATION)
      // .duration(300)
      .attrTween("d", function (d, i) {
        return flubber.toCircle(
          path(d),
          d.properties.centroid[0],
          d.properties.centroid[1],
          d.properties.radius,
          {
            maxSegmentLength: 3,
          }
        );
      })
  );
}

function renderGeography() {
  svg = d3
    .select("#map")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  // add a clip path to the svg element so that the circles are clipped
  svg
    .append("defs")
    .append("clipPath")
    .attr("id", "clip")
    .append("rect")
    .attr("width", width - margin.left - margin.right)
    .attr("height", height - margin.bottom - margin.top)
    .attr("x", 0)
    .attr("y", 0);

  let mainGroup = svg
    .append("g")
    .attr("class", "mainGroup")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  let plotArea = mainGroup.append("g").attr("class", "plotGroup");

  plotArea.attr("clip-path", "url(#clip)").attr("transform", "translate(0,0)");
  // add background color to plot area

  plotArea
    .append("rect")
    .attr("width", width - margin.left - margin.right)
    .attr("height", height - margin.top - margin.bottom)
    .attr("x", 0)
    .attr("y", 0)
    .attr("fill", BACKGROUND);

  const pathGroup = plotArea.append("g").attr("class", "pathGroup");

  let opcineSelection = pathGroup
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
    .attr("fill-opacity", 0.8)
    .attr("stroke", BACKGROUND)
    .attr("d", path);

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
        zup_name: municipality.properties.NAME_1,
        population: population ? +population.Population : 0,
        area: population ? +population.Area : 0,
      };

      const name = `${municipality.properties.NAME_2}`;
      const zup_name = `${municipality.properties.NAME_1}`;
      const votingDatum = votingData.find(
        (d) => d.gropNaziv.toUpperCase() == name.toUpperCase()
      );

      if (!votingDatum) {
        // console.log(`Missing match: ${name}`);
        // console.log(municipality.properties);
      }

      const jlsDatum = jlsData.find(
        (d) => d.jls.toUpperCase() == name.toUpperCase()
      );

      return {
        ...municipality,
        properties: {
          name,
          zup_name,
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
