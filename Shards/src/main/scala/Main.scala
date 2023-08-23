package eu.philbot

import akka.actor.ActorSystem
import akka.http.scaladsl.Http
import akka.http.scaladsl.model._
import akka.http.scaladsl.server.Directives._
import akka.http.scaladsl.marshallers.sprayjson.SprayJsonSupport._
import spray.json.DefaultJsonProtocol._
import spray.json.RootJsonFormat

final case class Config(shard_index: Long, shard_count: Long)

implicit val configFormat: RootJsonFormat[Config] = jsonFormat2(Config.apply)

var shard_count = 1
var configs : List[(String, Config)] = List()

class ShardChecker extends Runnable {
  override def run() {
    while(true) {
    	synchronized {
    	  shard_count = queryDesiredShardCount()
    	  configs = configs.filter(p => p._2.shard_count != shard_count)
    	}
    	Thread.sleep(1000 * 60)
    }
  }
}

def queryDesiredShardCount() {
  return 1; //TODO
}

def computeConfig(gateway_id: String, config: Config): Config = {
  synchronized {
    var shard_index = Nil
    if (config.shard_index == Nil || config.shard_count == Nil) {
      // first time asking for config
      createNewConfig(gateway_id)
    } else if (config.shard_count != shard_count) {
      // we are asked to confirm the config, but the shard count assumption is incorrect, just completely re-initialize
      createNewConfig(gateway_id)
    } else if (config.shard_count == shard_count && configs.exists(p => p._2.shard_index == config.shard_index && p._1 != gateway_id)) {
      // we are asked to confirm the config, but somebody else claimed that shard, re-initialize
      createNewConfig(gateway_id)
    } else {
      // config seems to be valid -> confirm
      config
    }
  }
}

def createNewConfig(gateway_id: String): Config = {
  synchronized {
    for (shard_index <- 0 to shard_count) {
      if (!configs.exists(p => p._2.shard_index == shard_index)) {
        var config = Config(shard_index, shard_count)
        configs = configs.filter(p => p._1 != gateway_id).filter(p => p._2.shard_index != shard_index);
        configs += Tuple2(gateway_id, config)
        config
      }
    }
  }
  Config(null, null)
}

object Main extends App {
  implicit val system = ActorSystem("GatewayActorSystem")
  implicit val executionContext = system.dispatcher
  
  new Thread(new ShardChecker()).start()

  private val server = Http(system).newServerAt("localhost", 8080)

  server.bind(path("ping") {
    get {
      complete(HttpEntity(ContentTypes.`text/plain(UTF-8)`, "pong"))
    }
  })
  server.bind(path("gateway" / "config" / Segment) { gateway_id =>
    post {
      entity(as[Config]) { config =>
        complete(computeConfig(gateway_id, config))
      }
    }
  })
}
