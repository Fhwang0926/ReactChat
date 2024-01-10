'use strict';

let Koa = require("koa");
let app = new Koa();

const Router = require("koa-router");
const bodyParser = require("koa-bodyparser");
const cors = require("@koa/cors");
const https = require("https");
const http = require("http");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const send = require("koa-send");
const serve = require("koa-static-server");
const _ = require("lodash");
const config = require("./config");

async function from_ip(ctx, next) {
  let req = ctx.request;
  let fn = (req) => {
    if (req.connection) {
      // Remote address checks.
      if (req.connection.remoteAddress) {
        return req.connection.remoteAddress;
      }
      if (req.connection.socket && req.connection.socket.remoteAddress) {
        return req.connection.socket.remoteAddress;
      }
    }
    if (req.socket && req.socket.remoteAddress) {
      return req.socket.remoteAddress;
    }
    if (req.info && req.info.remoteAddress) {
      return req.info.remoteAddress;
    }
  };

  req["from_ip"] = (fn(req) || "0.0.0.0").replace(/::ffff:/, ""); // IPv6 remove
  if (
    (req["from_ip"] == "localhost" || req["from_ip"] == "127.0.0.1") &&
    req.header["x-forwarded-for"]
  ) {
    req["from_ip"] = req.header["x-forwarded-for"].split(",")[0].trim();
  }
  await next();
}

let run = () => {
  // body parser, set limit size
  app.use(bodyParser({ jsonLimit: "500mb", formLimit: "500mb" }));

  // CORS 옵션
  let cors_option = {
    origin: "*",
    privateNetworkAccess: true,
    credentials: true,
  };

  // CORS 허용
  app.proxy = true; // true 일때 proxy 헤더들을 신뢰함
  app.use(cors(cors_option));
  app.use((ctx, next) => {
    // 구글 크롬 보안 이슈
    ctx.response.header["Access-Control-Allow-Private-Network"] = true;
    return next();
  });

  // cors
  // app.use(cors())
  app.use(from_ip);

  try {

    app.use((ctx, next) => {

      try {

        if(ctx.request.method.startsWith('/api') ) {
          console.log(
            `${ctx.request.from_ip} -> ${ctx.request.method} : ${ctx.request.url}`
          );
        }

        if (_.startsWith(ctx.request.url, "/api/auth")) {
          return next();
        }
        if (ctx.request.url.startsWith("/images")) {
          return next();
        }

        if (ctx.request.url.startsWith("/hdh")) {
          return ctx.body = "welcome web framework site";
        }

        // api 는 인증 해야 함
        if (ctx.request.url.startsWith("/api")) {
          try {
            if (!ctx.request.header["authorization"]) {
              throw "token verify first";
            }

            let token =
              ctx.request.header["authorization"] ||
              ctx.request.header["Authorization"];

            token = token.replace(/bearer /gi, "");

            if (!token) { return ctx.throw('api is require token') }

            let info = jwt.verify(token, config.pls.auth.secret);
            ctx.request.profile = info.profile;

            return next();
          } catch (err) {
            // will only respond with JSON
            console.log('web error', err)
            ctx.throw(401, 'no have permission')
            // ctx.status = 401;
            // return ctx.body = {
            //   error: { code: err.statusCode, message: err.message },
            // };
          }
        }

        return next();
      } catch (err) {
        // will only respond with JSON
        ctx.status = err.statusCode || err.status || 500;
        ctx.body = {
          error: {
            code: err.statusCode,
            message: err.message,
          },
        };
      }
    })
    

    // 이미지 매칭 순서 때문에 먼저 시작
    app.use(serve({ rootDir: "images", rootPath: "/images" }));

    // 사용자
    app.use(serve({ rootDir: "wwwroot", rootPath : '/', index : 'index.html', log : process.env.NODE_ENV == 'DEV' }));

    app.use(async (ctx) => {
      if(ctx.status === 404) await send(ctx, '404.html', { root: 'wwwroot' });
    });

    

    let protocol = config.ssl.use ? "https" : "http";
    if (process.argv.length > 2 && Number(process.argv[2]) > 0) {
      process.env.PORT = Number(process.argv[2]);
    }
    if (config.ssl.use) {
      if (config.port != 443) {
        // open ssl and http to https
        app.use(require("koa-force-ssl")()); // force https
        http.all("*", function (req, res) {
          res.redirect("https://" + req.headers.host + req.url);
        });
        http.createServer().listen(config.port, config.host, () => {
          console.log(
            `Listening on ${protocol}://${config.host}:${config.port}...`
          );
        });
      }

      // using https:(ssl)
      if (!config.ssl.key) {
        throw "no have ssl key";
      }
      if (!config.ssl.cert) {
        throw "no have ssl cert";
      }

      const options = {
        key: fs.readFileSync(config.ssl.key),
        cert: fs.readFileSync(config.ssl.cert),
      };

      // start https
      let server = https
        .createServer(options, app.callback())
        .listen(config.http.port, config.http.host, () => {
          console.log(
            `Listening on ${protocol}://${config.http.host}:${config.http.port}...`
          );
          require("./socket")(server);
        });
    } else {
      // using http only
      let server = http
        .createServer(app.callback())
        .listen(
          process.env.PORT ? process.env.PORT : config.port,
          config.host,
          () => {
            console.log(
              `Listening on ${protocol}://${config.host}:${
                process.env.PORT ? process.env.PORT : config.port
              }...`
            );
            require("./socket")(server);
          }
        );
    }

    app.on("error", async (err, ctx) => {
      // 디버깅 에러용
      console.log("error", err, ctx.request);

    });

  } catch (e) {
    console.log(e);
  }
};

run();