package eu.philbot

import akka.actor.ActorSystem
import akka.http.scaladsl.Http
import akka.http.scaladsl.model._
import akka.http.scaladsl.server.Directives._
import akka.http.scaladsl.marshallers.sprayjson.SprayJsonSupport._
import sttp.client3._
import spray.json.DefaultJsonProtocol._
import spray.json.RootJsonFormat

import scala.concurrent.ExecutionContextExecutor

object Main extends App {
  final case class Config(shard_index: Long, shard_count: Long)

  implicit val configFormat: RootJsonFormat[Config] = jsonFormat2(Config.apply)

  private var shard_count: Int = 1
  private var configs: List[(String, Config)] = List()

  private class ShardChecker extends Runnable {
    override def run(): Unit = {
      while (true) {
        synchronized {
          shard_count = queryDesiredShardCount()
          configs = configs.filter(p => p._2.shard_count != shard_count)
        }
        Thread.sleep(1000 * 60)
      }
    }
  }

  private def queryDesiredShardCount(): Int = {
    val request = basicRequest.get(uri"https://discord.com/api/v10/gateway/bot")
      .header("Authorization", "Bot " + System.getenv("DISCORD_API_TOKEN"))
    val response = request.send(HttpURLConnectionBackend())
    val json = response.body.toString
    val intro = "\"shards\":"
    var index = json.indexOf(intro) + intro.length
    var count = 0
    while (index < json.length && Character.isDigit(json.charAt(index))) {
      count = count * 10 + (json.charAt(index) - '0')
      index += 1
    }
    count
  }

  private def computeConfig(gateway_id: String, config: Config): Config = {
    synchronized {
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

  private def createNewConfig(gateway_id: String): Config = {
    synchronized {
      for (shard_index <- 0 to shard_count) {
        if (!configs.exists(p => p._2.shard_index == shard_index)) {
          val config = Config(shard_index, shard_count)
          configs = configs.filter(p => p._1 != gateway_id).filter(p => p._2.shard_index != shard_index)
          configs = configs.::((gateway_id, config))
          return config
        }
      }
    }
    Config(-1, -1)
  }

  implicit val system : ActorSystem = ActorSystem("GatewayActorSystem")
  implicit val executionContext : ExecutionContextExecutor = system.dispatcher
  
  new Thread(new ShardChecker()).start()

  private val server = Http(system).newServerAt("localhost", Integer.parseInt(System.getenv("PORT")))

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
